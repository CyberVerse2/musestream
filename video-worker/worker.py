"""One Reactor H3 Reference session for one musestream stream, saved clip by clip.

The Node server starts this process when a stream should show generated video.

    uv run worker.py --out DIR --max-seconds 60 --idle-prompt "..." --idle-seconds 6 \
        [--image AVATAR] [--image SCENE] [--voice SAMPLE.wav]

H3 plays a queue of 5 to 15 second clips in a 9:16 frame. Each clip continues from the one
before it, and every clip gets the same references: the --image pictures, in order, and the
--voice sample as the host's voice. The server writes each clip's prompt. Between the
clips it asks for, the worker keeps an idle clip queued, so the picture never stops.

Every clip that plays is saved to DIR as an mp4 with its own sound. Viewers' players play
the files back to back, so the stream looks continuous.

stdin, one JSON object per line:
    {"clip": {"prompt": "...", "seconds": 8}}   play this next, ahead of any waiting idle clip
    {"idle": {"prompt": "...", "seconds": 6}}   what to play when nothing else is queued
    {"stop": true}                              end the session now

stdout, one JSON object per line:
    {"event": "connected"}
    {"event": "clip", "file": "00003-speech.mp4", "kind": "speech"}   a clip is saved
    {"event": "ended", "reason": "...", "seconds": 61.2}

Money safety: the session is billed while it exists. It ends when any of these happen:
the --max-seconds timer, a stop message, stdin closing (the server went away), a signal,
or an error. Reactor also ends it on its side after --max-seconds + 15 s, even if this
process is killed before it can disconnect.
"""

import argparse
import asyncio
import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from reactor_sdk import Reactor

MODEL = "reactor/h3-reference-to-video-turbo-realtime"
FPS = 24
AUDIO_RATE = 48000  # 48 kHz mono, 16-bit PCM
AUDIO_CHANNELS = 1
# frames that come in before their clip's start event, kept for it (4 MB each)
EARLY_FRAMES = 12

output_lock = threading.Lock()


def emit(event: str, **fields) -> None:
    with output_lock:
        print(json.dumps({"event": event, **fields}), flush=True)


class ClipFile:
    """One clip on its way to disk: frames go to an ffmpeg encoder as they arrive, sound is
    kept in memory, and once both are complete they are joined into DIR/NAME.mp4."""

    def __init__(self, out: Path, name: str, kind: str, frames: int) -> None:
        self.out = out
        self.name = name
        self.kind = kind
        self.expected = frames
        self.frames = 0
        self.sound = bytearray()
        self.finished = False  # Reactor reported the clip over
        self.video = out / f".{name}.video.mp4"
        self.queue: "queue.Queue[bytes | None]" = queue.Queue()
        self.proc: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None

    def add_frame(self, bgra: bytes, width: int, height: int) -> None:
        if self.proc is None:
            self.proc = subprocess.Popen(
                [
                    "ffmpeg", "-loglevel", "error", "-y",
                    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{width}x{height}",
                    "-r", str(FPS), "-i", "-",
                    # the model renders 768x1344; phones need no more than 540 wide
                    "-vf", "scale=540:-2,format=yuv420p",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    str(self.video),
                ],
                stdin=subprocess.PIPE,
            )
            self.thread = threading.Thread(target=self.encode, daemon=True)
            self.thread.start()
        self.queue.put(bgra)
        self.frames += 1

    def encode(self) -> None:
        assert self.proc is not None and self.proc.stdin is not None
        while (frame := self.queue.get()) is not None:
            try:
                self.proc.stdin.write(frame)
            except (BrokenPipeError, ValueError, OSError):
                break
        try:
            self.proc.stdin.close()
        except (BrokenPipeError, OSError):
            pass
        self.proc.wait()

    @property
    def complete(self) -> bool:
        return self.finished and self.frames >= self.expected

    def save(self) -> None:
        """join picture and sound into the clip's file, off the event loop"""
        threading.Thread(target=self._save, daemon=True).start()

    def _save(self) -> None:
        if self.proc is None or self.thread is None:
            return
        self.queue.put(None)
        self.thread.join()
        pcm = self.out / f".{self.name}.pcm"
        pcm.write_bytes(bytes(self.sound))
        part = self.out / f".{self.name}.mp4"
        result = subprocess.run(
            [
                "ffmpeg", "-loglevel", "error", "-y",
                "-i", str(self.video),
                "-f", "s16le", "-ar", str(AUDIO_RATE), "-ac", str(AUDIO_CHANNELS), "-i", str(pcm),
                "-map", "0:v", "-map", "1:a",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "96k",
                # sound is cut or padded to the picture's length
                "-af", "apad", "-shortest",
                "-movflags", "+faststart",
                str(part),
            ],
        )
        self.video.unlink(missing_ok=True)
        pcm.unlink(missing_ok=True)
        if result.returncode != 0:
            print(f"clip {self.name} could not be saved", file=sys.stderr, flush=True)
            return
        os.replace(part, self.out / f"{self.name}.mp4")
        emit("clip", file=f"{self.name}.mp4", kind=self.kind)


class Recorder:
    """Hands each frame and each piece of sound to the clip playing now.

    Frames arrive only while a clip plays; the audio track runs all session long, so sound
    is kept only while a clip plays. A clip is saved when all its frames are in and Reactor
    has reported it finished."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.lock = threading.Lock()
        self.current: ClipFile | None = None
        self.early: list[tuple[bytes, int, int]] = []
        self.saved = 0
        self.frames = 0

    def start_clip(self, name: str, kind: str, frames: int) -> None:
        with self.lock:
            self.out.mkdir(parents=True, exist_ok=True)
            previous, self.current = self.current, ClipFile(self.out, name, kind, frames)
            early, self.early = self.early, []
            for frame in early:
                self.current.add_frame(*frame)
        if previous is not None:
            previous.save()  # a clip whose last frames never came is saved as it is

    def finish_clip(self, name: str) -> None:
        with self.lock:
            clip = self.current
            if clip is None or clip.name != name:
                return
            clip.finished = True
            if clip.complete:
                self.current = None
        if clip.complete:
            clip.save()

    def frame(self, bgra: bytes, width: int, height: int) -> None:
        done = None
        with self.lock:
            self.frames += 1
            clip = self.current
            if clip is None or clip.frames >= clip.expected:
                self.early = (self.early + [(bgra, width, height)])[-EARLY_FRAMES:]
                return
            clip.add_frame(bgra, width, height)
            if clip.complete:
                done, self.current = clip, None
        if done is not None:
            done.save()

    def audio(self, pcm: bytes) -> None:
        with self.lock:
            if self.current is not None and not self.current.finished:
                self.current.sound.extend(pcm)

    def close(self) -> None:
        with self.lock:
            clip, self.current = self.current, None
        if clip is not None:
            clip.save()


class ClipQueue:
    """Keeps H3's queue fed: the server's clips first, and an idle clip whenever the queue
    would otherwise run dry. Each clip is tagged through `metadata` so its events can be
    matched to it, and continues from the clip before it."""

    def __init__(self, reactor: Reactor, images: list, audios: list, idle: dict) -> None:
        self.reactor = reactor
        self.images = images
        self.audios = audios
        self.idle = idle
        self.count = 0
        self.kinds: dict[str, str] = {}
        self.ids: dict[str, str] = {}
        self.waiting: list[str] = []  # tags queued and not yet playing, in order
        self.current: str | None = None
        self.last_payload: dict | None = None
        self.unwanted: set[str] = set()  # dropped before Reactor queued them

    def tail_id(self) -> str | None:
        """the clip the next one continues from: the last one waiting, else the one playing"""
        tag = self.waiting[-1] if self.waiting else self.current
        return self.ids.get(tag) if tag else None

    async def add(self, clip: dict, kind: str) -> None:
        self.count += 1
        tag = f"{self.count:05d}-{kind}"
        payload = {
            "prompt": clip["prompt"],
            "seconds": clip["seconds"],
            "reference_images": self.images,
            "metadata": tag,
        }
        if self.audios:
            payload["reference_audios"] = self.audios
        if (after := self.tail_id()) is not None:
            payload["continue_from_clip_id"] = after
        self.kinds[tag] = kind
        self.waiting.append(tag)
        self.last_payload = payload
        await self.reactor.send_command("enqueue", payload)

    async def drop_waiting_idle(self) -> None:
        """take back idle clips that have not started, so a new clip plays sooner"""
        for tag in [t for t in self.waiting if self.kinds[t] == "idle"]:
            self.waiting.remove(tag)
            if tag in self.ids:
                await self.reactor.send_command("pop", {"clip_id": self.ids[tag]})
            else:
                self.unwanted.add(tag)

    async def speak(self, clip: dict) -> None:
        await self.drop_waiting_idle()
        await self.add(clip, "speech")

    async def set_idle(self, clip: dict) -> None:
        self.idle = clip
        await self.drop_waiting_idle()
        if not self.waiting:
            await self.add(clip, "idle")

    async def on_event(self, kind: str, data: dict, recorder: Recorder) -> None:
        clip = data.get("clip") or {}
        tag = clip.get("metadata")
        if kind == "clip_queued" and tag and clip.get("clip_id"):
            self.ids[tag] = clip["clip_id"]
            if tag in self.unwanted:
                self.unwanted.discard(tag)
                await self.reactor.send_command("pop", {"clip_id": clip["clip_id"]})
        elif kind == "clip_started" and tag in self.kinds:
            self.unwanted.discard(tag)
            if tag in self.waiting:
                self.waiting.remove(tag)
            self.current = tag
            recorder.start_clip(tag, self.kinds[tag], int(clip.get("frames") or 0))
            if not self.waiting:
                await self.add(self.idle, "idle")
        elif kind == "clip_finished" and tag:
            recorder.finish_clip(tag)
        elif kind == "clip_failed" and tag in self.waiting:
            self.waiting.remove(tag)
            print(f"clip failed: {json.dumps(data)[:300]}", file=sys.stderr, flush=True)
            if not self.waiting:
                await self.add(self.idle, "idle")
        elif kind == "command_error":
            print(f"command refused: {json.dumps(data)[:300]}", file=sys.stderr, flush=True)
            # a clip that cannot continue from the one before still plays on its own; a
            # clip Reactor already queued was not the one refused
            last = self.last_payload
            if last and "continue_from_clip_id" in last and last["metadata"] not in self.ids:
                retry = {k: v for k, v in last.items() if k != "continue_from_clip_id"}
                self.last_payload = retry
                await self.reactor.send_command("enqueue", retry)


def read_commands(loop: asyncio.AbstractEventLoop, inbox: asyncio.Queue) -> None:
    """Forward stdin lines to the inbox; closed stdin means stop.

    Runs on a daemon thread: a blocked read must not keep the process alive once the
    session has ended.
    """
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        loop.call_soon_threadsafe(inbox.put_nowait, msg)
    loop.call_soon_threadsafe(inbox.put_nowait, {"stop": True, "reason": "server_gone"})


async def run(args: argparse.Namespace) -> None:
    api_key = os.environ.get("REACTOR_API_KEY")
    if not api_key:
        emit("ended", reason="no_api_key", seconds=0)
        return

    recorder = Recorder(Path(args.out))
    reactor = Reactor(
        model_name=MODEL,
        api_key=api_key,
        # Reactor's own cap, in case this process dies before it can disconnect
        max_session_duration_seconds=args.max_seconds + 15,
    )
    inbox: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    @reactor.track("main_video").on_raw_frame
    def on_frame(bgra, width, height, frame_id, timestamp_us, user_data):
        recorder.frame(bytes(bgra), width, height)

    @reactor.track("main_audio").on_raw_frame
    def on_audio(pcm, num_samples, sample_rate, num_channels):
        recorder.audio(bytes(pcm))

    @reactor.on_message
    def on_message(msg):
        loop.call_soon_threadsafe(inbox.put_nowait, {"reactor": msg})

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: inbox.put_nowait({"stop": True, "reason": "signal"}))

    started = time.monotonic()
    reason = "error"
    try:
        await reactor.connect()
        emit("connected")
        await reactor.send_command("set_canvas", {"aspect": "9:16"})
        await reactor.send_command("set_autoplay", {"enabled": True})
        images = [await reactor.upload_file(path) for path in args.image]
        audios = [await reactor.upload_file(args.voice)] if args.voice else []
        clips = ClipQueue(reactor, images, audios, {"prompt": args.idle_prompt, "seconds": args.idle_seconds})
        await clips.add(clips.idle, "idle")

        threading.Thread(target=read_commands, args=(loop, inbox), daemon=True).start()
        deadline = started + args.max_seconds
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                reason = "time_cap"
                break
            try:
                msg = await asyncio.wait_for(inbox.get(), timeout=left)
            except asyncio.TimeoutError:
                continue
            if msg.get("stop"):
                reason = msg.get("reason", "stopped")
                break
            if isinstance(msg.get("reactor"), dict):
                event = msg["reactor"]
                await clips.on_event(event.get("type", ""), event.get("data") or {}, recorder)
            elif isinstance(msg.get("clip"), dict):
                await clips.speak(msg["clip"])
            elif isinstance(msg.get("idle"), dict):
                await clips.set_idle(msg["idle"])
    except Exception as err:  # noqa: BLE001 - report every failure to the server
        print(f"worker error: {err!r}", file=sys.stderr, flush=True)
        reason = "error"
    finally:
        # in Python, disconnect() always terminates the session, which stops billing
        try:
            await reactor.disconnect()
        except Exception:  # noqa: BLE001
            pass
        recorder.close()
        emit("ended", reason=reason, seconds=round(time.monotonic() - started, 1), frames=recorder.frames)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-seconds", type=int, default=60)
    parser.add_argument("--idle-prompt", required=True, help="the clip that plays when nothing else is queued")
    parser.add_argument("--idle-seconds", type=float, default=6)
    parser.add_argument("--image", action="append", default=[], help="reference picture; repeat, in order")
    parser.add_argument("--voice", help="sample of the host's voice")
    args = parser.parse_args()
    if not 5 <= args.max_seconds <= 600:
        parser.error("--max-seconds must be between 5 and 600")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
