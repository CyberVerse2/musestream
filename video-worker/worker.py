"""One Reactor H3 Reference session for one musestream stream, saved clip by clip.

The Node server starts this process when a stream should show generated video.

    uv run worker.py --out DIR --max-seconds 60 --idle-prompt "..." --idle-seconds 6 \
        [--image AVATAR] [--image SCENE] [--voice SAMPLE.wav]

H3 plays a queue of 5 to 15 second clips in a 9:16 frame. Each clip continues from the one
before it, and every clip gets the same references: the --image pictures, in order, and the
--voice sample as the host's voice (idle clips get no voice sample, and are saved silent). A
clip can bring its own reference audio instead, such as a slice of a song: H3 then sings it,
lips in time with it. The server writes each clip's
prompt. Between the clips it asks for, the worker keeps an idle clip queued, so the picture
never stops.

Every clip that plays is saved to DIR as an mp4 with its own sound. Viewers' players play
the files back to back, so the stream looks continuous.

stdin, one JSON object per line:
    {"clip": {"prompt": "...", "seconds": 8}}   play this next, ahead of any waiting idle clip
        optional: "audio": "/path/slice.wav"  this clip's reference audio
                  "sound": "/path/slice.wav"  saved as the clip's sound in place of H3's
                  "kind": "song"              names the saved file (default "speech")
    {"idle": {"prompt": "...", "seconds": 6}}   what to play when nothing else is queued
    {"stop": true}                              end the session now

stdout, one JSON object per line:
    {"event": "connected"}
    {"event": "clip", "file": "00003-speech.mp4", "kind": "speech"}   a clip is saved
    {"event": "failed", "kind": "song"}                               a clip was not made
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
# after Reactor reports a clip finished, how long its last frames have to arrive
FINISH_GRACE_SECONDS = 0.5
# a frame this close ahead of its clip's start message belongs to that clip
EARLY_SECONDS = 0.5

output_lock = threading.Lock()


def emit(event: str, **fields) -> None:
    with output_lock:
        print(json.dumps({"event": event, **fields}), flush=True)


class ClipFile:
    """One clip on its way to disk: frames go to an ffmpeg encoder as they arrive, sound is
    kept in memory, and once the clip is over they are joined into DIR/NAME.mp4.

    Frames stream in real time and some never arrive, so each frame is placed by when it came
    in: a gap is filled by holding the frame before it, and the clip always ends up exactly as
    long as H3 made it. Its sound, and a song laid over it later, stay in time."""

    def __init__(self, out: Path, name: str, kind: str, frames: int, sound: str | None) -> None:
        self.out = out
        self.name = name
        self.kind = kind
        # a file to use as the clip's sound in place of what H3 played, e.g. a song's own slice
        self.sound_file = sound
        self.expected = frames
        self.frames = 0  # written, counting held frames
        self.received = 0
        self.first_at: float | None = None
        self.last: tuple[bytes, int, int] | None = None
        self.sound = bytearray()
        self.finished = False  # Reactor reported the clip over
        self.closed = False  # no more frames: it is being saved
        self.video = out / f".{name}.video.mp4"
        self.queue: "queue.Queue[bytes | None]" = queue.Queue()
        self.proc: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None
        self.saver: threading.Thread | None = None

    def add_frame(self, bgra: bytes, width: int, height: int, at: float) -> bool:
        """place a frame that came in at `at`; False when it falls past the clip's end"""
        if self.first_at is None:
            self.first_at = at
        slot = round((at - self.first_at) * FPS)
        if self.frames >= self.expected or slot >= self.expected:
            return False
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
        while self.last is not None and self.frames < slot:
            self.queue.put(self.last[0])
            self.frames += 1
        self.queue.put(bgra)
        self.frames += 1
        self.received += 1
        self.last = (bgra, width, height)
        return True

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

    def save(self) -> None:
        """hold the last frame to the clip's full length, then join picture and sound into
        its file, off the event loop"""
        while self.last is not None and self.frames < self.expected:
            self.queue.put(self.last[0])
            self.frames += 1
        self.saver = threading.Thread(target=self._save, daemon=True)
        self.saver.start()

    def _save(self) -> None:
        if self.proc is None or self.thread is None:
            return
        self.queue.put(None)
        self.thread.join()
        pcm = self.out / f".{self.name}.pcm"
        pcm.write_bytes(bytes(self.sound))
        if self.sound_file:
            sound = ["-i", self.sound_file]
        elif self.kind == "idle":
            # the host is quiet between beats; whatever H3 murmured is left out
            sound = ["-f", "lavfi", "-i", f"anullsrc=r={AUDIO_RATE}:cl=mono"]
        else:
            sound = ["-f", "s16le", "-ar", str(AUDIO_RATE), "-ac", str(AUDIO_CHANNELS), "-i", str(pcm)]
        part = self.out / f".{self.name}.mp4"
        result = subprocess.run(
            [
                "ffmpeg", "-loglevel", "error", "-y",
                "-i", str(self.video),
                *sound,
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
        print(f"clip {self.name}: {self.received} of {self.expected} frames came in", file=sys.stderr, flush=True)
        emit("clip", file=f"{self.name}.mp4", kind=self.kind)


class Recorder:
    """Hands each frame and each piece of sound to the clip playing now.

    Frames arrive only while a clip plays; the audio track runs all session long, so sound
    is kept only while a clip plays. Clips start and finish on Reactor's messages, which are
    handled the moment they arrive. A clip is saved once it is full, or shortly after Reactor
    reports it finished (its last frames may still be on their way), or when the next starts."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.lock = threading.Lock()
        # clips that bring their own sound, by tag
        self.sounds: dict[str, str] = {}
        self.current: ClipFile | None = None
        self.early: list[tuple[bytes, int, int, float]] = []
        self.clips: list[ClipFile] = []
        self.frames = 0

    def start_clip(self, name: str, kind: str, frames: int) -> None:
        with self.lock:
            self.out.mkdir(parents=True, exist_ok=True)
            previous, self.current = self.current, ClipFile(self.out, name, kind, frames, self.sounds.get(name))
            self.clips.append(self.current)
            early, self.early = self.early, []
            # only frames that came just ahead of this message are its own; older ones are
            # the tail of the clip before
            now = time.monotonic()
            for frame in early:
                if now - frame[3] <= EARLY_SECONDS:
                    self.current.add_frame(*frame)
            if previous is not None:
                self._close(previous)

    def finish_clip(self, name: str) -> None:
        with self.lock:
            clip = self.current
            if clip is None or clip.name != name:
                return
            clip.finished = True
        # its last frames may still be in flight
        timer = threading.Timer(FINISH_GRACE_SECONDS, self._finish, args=(clip,))
        timer.daemon = True
        timer.start()

    def _finish(self, clip: ClipFile) -> None:
        with self.lock:
            if self.current is clip:
                self.current = None
            self._close(clip)

    def _close(self, clip: ClipFile) -> None:
        """save a clip once; call with the lock held"""
        if not clip.closed:
            clip.closed = True
            clip.save()

    def frame(self, bgra: bytes, width: int, height: int) -> None:
        at = time.monotonic()
        with self.lock:
            self.frames += 1
            clip = self.current
            if clip is not None and not clip.closed and clip.add_frame(bgra, width, height, at):
                if clip.frames >= clip.expected:
                    self.current = None
                    self._close(clip)
                return
            # a frame of the next clip, ahead of its start message
            self.early = (self.early + [(bgra, width, height, at)])[-EARLY_FRAMES:]

    def audio(self, pcm: bytes) -> None:
        with self.lock:
            if self.current is not None and not self.current.finished:
                self.current.sound.extend(pcm)

    def close(self) -> None:
        """save what is left and wait for every save, so no clip is lost when the session ends"""
        with self.lock:
            clip, self.current = self.current, None
            if clip is not None:
                self._close(clip)
            savers = [c.saver for c in self.clips if c.saver is not None]
        for saver in savers:
            saver.join()


class ClipQueue:
    """Keeps H3's queue fed: the server's clips first, and an idle clip whenever the queue
    would otherwise run dry. Each clip is tagged through `metadata` so its events can be
    matched to it, and continues from the clip before it.

    H3 continues only from a clip that has finished generating (any other id is ignored
    without a word), so a clip whose predecessor is still being made waits in `held` and is
    enqueued once it is ready. Builds happen one at a time anyway, so nothing is slower."""

    def __init__(self, reactor: Reactor, recorder: "Recorder", images: list, audios: list, idle: dict) -> None:
        self.reactor = reactor
        self.recorder = recorder
        self.images = images
        self.audios = audios
        self.idle = idle
        # a clip's own reference audio, uploaded once per file
        self.clip_audios: dict[str, asyncio.Future] = {}
        self.count = 0
        self.kinds: dict[str, str] = {}
        self.ids: dict[str, str] = {}
        self.waiting: list[str] = []  # tags queued and not yet playing, in order
        self.current: str | None = None
        self.generated: set[str] = set()
        self.held: list[dict] = []
        self.payloads: dict[str, dict] = {}
        self.unacked: list[str] = []  # enqueued, not yet answered, oldest first
        self.unwanted: set[str] = set()  # dropped before Reactor queued them

    def tail(self) -> str | None:
        """the clip the next one continues from: the last one waiting, else the one playing"""
        return self.waiting[-1] if self.waiting else self.current

    def ready(self) -> bool:
        """whether a new clip can be enqueued now and still continue the one before"""
        tail = self.tail()
        return tail is None or tail in self.generated

    async def add(self, clip: dict, kind: str) -> None:
        self.count += 1
        tag = f"{self.count:05d}-{kind}"
        payload = {
            "prompt": clip["prompt"],
            "seconds": clip["seconds"],
            "reference_images": self.images,
            "metadata": tag,
        }
        if path := clip.get("audio"):
            if path not in self.clip_audios:
                self.clip_audios[path] = asyncio.ensure_future(self.reactor.upload_file(path))
            payload["reference_audios"] = [await self.clip_audios[path]]
        elif self.audios and kind != "idle":
            # H3 repeats the words of its reference audio when a clip gives it nothing to say,
            # so a silent idle clip gets no voice sample to recite
            payload["reference_audios"] = self.audios
        if clip.get("sound"):
            self.recorder.sounds[tag] = clip["sound"]
        tail = self.tail()
        if tail in self.generated and tail in self.ids:
            payload["continue_from_clip_id"] = self.ids[tail]
        self.kinds[tag] = kind
        self.waiting.append(tag)
        self.payloads[tag] = payload
        self.unacked.append(tag)
        await self.reactor.send_command("enqueue", payload)

    async def drop_waiting_idle(self) -> None:
        """take back idle clips that have not started, so a new clip plays sooner"""
        for tag in [t for t in self.waiting if self.kinds[t] == "idle"]:
            self.waiting.remove(tag)
            if tag in self.ids:
                await self.reactor.send_command("pop", {"clip_id": self.ids[tag]})
            else:
                self.unwanted.add(tag)

    async def play(self, clip: dict) -> None:
        # upload the clip's audio now, so it is ready when the clip is enqueued
        if (path := clip.get("audio")) and path not in self.clip_audios:
            self.clip_audios[path] = asyncio.ensure_future(self.reactor.upload_file(path))
        await self.drop_waiting_idle()
        self.held.append(clip)
        await self.release()

    async def release(self) -> None:
        """enqueue the next held clip once the one before it has been made"""
        if self.held and self.ready():
            clip = self.held.pop(0)
            await self.add(clip, clip.get("kind") or "speech")

    async def keep_going(self) -> None:
        """the next held clip, or else an idle one, so the queue never runs dry"""
        if self.held:
            await self.release()
        elif not self.waiting:
            await self.add(self.idle, "idle")

    async def failed(self, tag: str) -> None:
        if tag in self.waiting:
            self.waiting.remove(tag)
        emit("failed", kind=self.kinds.get(tag, ""))
        await self.keep_going()

    async def set_idle(self, clip: dict) -> None:
        self.idle = clip
        await self.drop_waiting_idle()
        await self.keep_going()

    async def on_event(self, kind: str, data: dict) -> None:
        clip = data.get("clip") or {}
        tag = clip.get("metadata")
        if kind == "clip_queued" and tag and clip.get("clip_id"):
            self.ids[tag] = clip["clip_id"]
            if tag in self.unacked:
                self.unacked.remove(tag)
            if tag in self.unwanted:
                self.unwanted.discard(tag)
                await self.reactor.send_command("pop", {"clip_id": clip["clip_id"]})
        elif kind == "clip_generated" and tag:
            self.generated.add(tag)
            await self.release()
        elif kind == "clip_started" and tag in self.kinds:
            self.unwanted.discard(tag)
            if tag in self.waiting:
                self.waiting.remove(tag)
            self.current = tag
            # a clip that plays has been made, whether or not an event said so
            self.generated.add(tag)
            await self.keep_going()
        elif kind == "clip_failed" and tag in self.waiting:
            print(f"clip failed: {json.dumps(data)[:300]}", file=sys.stderr, flush=True)
            await self.failed(tag)
        elif kind == "command_error":
            print(f"command refused: {json.dumps(data)[:300]}", file=sys.stderr, flush=True)
            if data.get("command") != "enqueue" or not self.unacked:
                return
            # answers come in the order the enqueues went out
            refused = self.unacked.pop(0)
            payload = self.payloads[refused]
            if "continue_from_clip_id" in payload:
                # a clip that cannot continue from the one before still plays on its own
                retry = {k: v for k, v in payload.items() if k != "continue_from_clip_id"}
                self.payloads[refused] = retry
                self.unacked.append(refused)
                await self.reactor.send_command("enqueue", retry)
            else:
                await self.failed(refused)


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

    inbox: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    recorder = Recorder(Path(args.out))
    reactor = Reactor(
        model_name=MODEL,
        api_key=api_key,
        # Reactor's own cap, in case this process dies before it can disconnect
        max_session_duration_seconds=args.max_seconds + 15,
    )
    @reactor.track("main_video").on_raw_frame
    def on_frame(bgra, width, height, frame_id, timestamp_us, user_data):
        recorder.frame(bytes(bgra), width, height)

    @reactor.track("main_audio").on_raw_frame
    def on_audio(pcm, num_samples, sample_rate, num_channels):
        recorder.audio(bytes(pcm))

    @reactor.on_message
    def on_message(msg):
        # the recorder follows clips the moment they start and finish: frames keep arriving
        # while the main loop is busy (an upload, say), and must go to the right clip
        if isinstance(msg, dict):
            clip = (msg.get("data") or {}).get("clip") or {}
            tag = clip.get("metadata")
            if tag and msg.get("type") == "clip_started":
                recorder.start_clip(tag, tag.split("-", 1)[-1], int(clip.get("frames") or 0))
            elif tag and msg.get("type") == "clip_finished":
                recorder.finish_clip(tag)
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
        clips = ClipQueue(reactor, recorder, images, audios, {"prompt": args.idle_prompt, "seconds": args.idle_seconds})
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
                await clips.on_event(event.get("type", ""), event.get("data") or {})
            elif isinstance(msg.get("clip"), dict):
                await clips.play(msg["clip"])
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
