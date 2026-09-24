"""One Reactor Orbis session for one lurkk stream, turned into HLS video.

The Node server starts this process when a stream should show generated video.

    uv run worker.py --out DIR --max-seconds 60 --prompt "first shot"

stdin, one JSON object per line:
    {"prompt": "next shot"}     steer the picture
    {"stop": true}              end the session now

stdout, one JSON object per line:
    {"event": "connected"}
    {"event": "playlist", "path": "DIR/live.m3u8"}   viewers can start watching
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
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from reactor_sdk import Reactor

MODEL = "reactor/visko-orbis-stable"
FPS = 18


def emit(event: str, **fields) -> None:
    print(json.dumps({"event": event, **fields}), flush=True)


class HlsWriter:
    """Pipes raw BGRA frames into ffmpeg, which writes a rolling HLS playlist."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.proc: subprocess.Popen | None = None
        self.frames = 0

    def write(self, bgra: bytes, width: int, height: int) -> None:
        if self.proc is None:
            self.out.mkdir(parents=True, exist_ok=True)
            self.proc = subprocess.Popen(
                [
                    "ffmpeg", "-loglevel", "error", "-y",
                    "-f", "rawvideo", "-pix_fmt", "bgra", "-s", f"{width}x{height}",
                    "-r", str(FPS), "-i", "-",
                    # the model generates at 832x480; delivery is upscaled, so scale back down
                    "-vf", "scale=-2:480,format=yuv420p",
                    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
                    "-g", str(FPS * 2), "-keyint_min", str(FPS * 2), "-sc_threshold", "0",
                    "-f", "hls", "-hls_time", "2", "-hls_list_size", "8",
                    "-hls_flags", "delete_segments+omit_endlist+independent_segments",
                    "-hls_segment_filename", str(self.out / "seg-%05d.ts"),
                    str(self.out / "live.m3u8"),
                ],
                stdin=subprocess.PIPE,
            )
        try:
            assert self.proc.stdin is not None
            self.proc.stdin.write(bgra)
            self.frames += 1
        except BrokenPipeError:
            pass

    def close(self) -> None:
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.close()
            except BrokenPipeError:
                pass
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def read_commands(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
    """Forward stdin lines to the queue; closed stdin means stop.

    Runs on a daemon thread: a blocked read must not keep the process alive once the
    session has ended.
    """
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        loop.call_soon_threadsafe(queue.put_nowait, msg)
    loop.call_soon_threadsafe(queue.put_nowait, {"stop": True, "reason": "server_gone"})


async def run(args: argparse.Namespace) -> None:
    api_key = os.environ.get("REACTOR_API_KEY")
    if not api_key:
        emit("ended", reason="no_api_key", seconds=0)
        return

    out = Path(args.out)
    writer = HlsWriter(out)
    playlist = out / "live.m3u8"
    reactor = Reactor(
        model_name=MODEL,
        api_key=api_key,
        # Reactor's own cap, in case this process dies before it can disconnect
        max_session_duration_seconds=args.max_seconds + 15,
    )

    @reactor.track("main_video").on_raw_frame
    def on_frame(bgra, width, height, frame_id, timestamp_us, user_data):
        writer.write(bgra, width, height)

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: queue.put_nowait({"stop": True, "reason": "signal"}))

    started = time.monotonic()
    reason = "error"
    try:
        await reactor.connect()
        emit("connected")
        # sound does not change the price, but skipping it makes chunks faster
        await reactor.send_command("set_audio_enabled", {"audio_enabled": False})
        await reactor.send_command("set_prompt", {"prompt": args.prompt})
        await reactor.send_command("start", {})

        threading.Thread(target=read_commands, args=(loop, queue), daemon=True).start()
        announced = False
        deadline = started + args.max_seconds
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                reason = "time_cap"
                break
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=min(left, 0.5))
            except asyncio.TimeoutError:
                msg = None
            if not announced and playlist.exists():
                announced = True
                emit("playlist", path=str(playlist))
            if msg is None:
                continue
            if msg.get("stop"):
                reason = msg.get("reason", "stopped")
                break
            if isinstance(msg.get("prompt"), str):
                await reactor.send_command("set_prompt", {"prompt": msg["prompt"]})
    except Exception as err:  # noqa: BLE001 - report every failure to the server
        print(f"worker error: {err!r}", file=sys.stderr, flush=True)
        reason = "error"
    finally:
        # in Python, disconnect() always terminates the session, which stops billing
        try:
            await reactor.disconnect()
        except Exception:  # noqa: BLE001
            pass
        writer.close()
        emit("ended", reason=reason, seconds=round(time.monotonic() - started, 1), frames=writer.frames)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--max-seconds", type=int, default=60)
    args = parser.parse_args()
    if not 5 <= args.max_seconds <= 600:
        parser.error("--max-seconds must be between 5 and 600")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
