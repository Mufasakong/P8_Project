from __future__ import annotations

import asyncio
import collections
import json
import os

import matplotlib.pyplot as plt
import websockets

WS_URL = os.getenv("PROSODY_WS", "ws://localhost:8765")
HISTORY = int(os.getenv("PROSODY_MONITOR_HISTORY", "300"))
CHANNEL_SELECT = os.getenv("PROSODY_MONITOR_CHANNEL", "mix")  # mix, left, right, mono, ch0, ch1...

rms = collections.deque(maxlen=HISTORY)
noise = collections.deque(maxlen=HISTORY)
snr = collections.deque(maxlen=HISTORY)
pause = collections.deque(maxlen=HISTORY)
vad = collections.deque(maxlen=HISTORY)
f0 = collections.deque(maxlen=HISTORY)
voiced = collections.deque(maxlen=HISTORY)

stereo_width = collections.deque(maxlen=HISTORY)
balance_db = collections.deque(maxlen=HISTORY)
correlation = collections.deque(maxlen=HISTORY)


def pick_payload(data: dict):
    if CHANNEL_SELECT in {"mix", "mono"}:
        return data

    channels = data.get("channels") or []
    if CHANNEL_SELECT == "left":
        wanted = "left"
    elif CHANNEL_SELECT == "right":
        wanted = "right"
    elif CHANNEL_SELECT.startswith("ch") and CHANNEL_SELECT[2:].isdigit():
        idx = int(CHANNEL_SELECT[2:])
        return channels[idx] if 0 <= idx < len(channels) else data
    else:
        wanted = CHANNEL_SELECT

    for ch in channels:
        if ch.get("channelName") == wanted:
            return ch
    return data


async def run():
    async with websockets.connect(WS_URL, max_size=2**23) as ws:
        await ws.send("monitor")
        print("Connected to", WS_URL, "as monitor")
        print("Channel selected:", CHANNEL_SELECT)

        plt.ion()
        fig, axs = plt.subplots(6, 1, figsize=(10, 11), sharex=True)

        while True:
            msg = await ws.recv()
            if isinstance(msg, bytes):
                continue

            data = json.loads(msg)
            if data.get("type") != "prosody_features":
                continue

            d = pick_payload(data)

            rms.append(float(d.get("rms", 0.0)))
            noise.append(float(d.get("noiseRms", 0.0)))
            snr.append(float(d.get("snrLike", 0.0)))
            pause.append(float(d.get("pauseMs", 0.0)))
            vad.append(int(d.get("vad", 0)))
            f0.append(float(d.get("f0Mean", 0.0)))
            voiced.append(float(d.get("voicedRatio", 0.0)))

            st = data.get("stereo") or {}
            stereo_width.append(float(st.get("stereoWidth", 0.0)))
            balance_db.append(float(st.get("balanceDbLeftMinusRight", 0.0)))
            correlation.append(float(st.get("leftRightCorrelation", 0.0)))

            axs[0].cla(); axs[0].set_title("RMS energy + noise floor")
            axs[0].plot(list(rms), label="rms")
            axs[0].plot(list(noise), label="noiseRms")
            axs[0].legend(loc="upper right")

            axs[1].cla(); axs[1].set_title("SNR-like = rms/noiseRms")
            axs[1].plot(list(snr))

            axs[2].cla(); axs[2].set_title("VAD")
            axs[2].plot(list(vad))

            axs[3].cla(); axs[3].set_title("Pause duration")
            axs[3].plot(list(pause))

            axs[4].cla(); axs[4].set_title("F0 mean + voiced ratio scaled")
            axs[4].plot(list(f0), label="f0Mean")
            axs[4].plot([v * 300 for v in voiced], label="voicedRatio*300")
            axs[4].legend(loc="upper right")

            axs[5].cla(); axs[5].set_title("Stereo descriptors: width, L-R balance, correlation")
            axs[5].plot(list(stereo_width), label="width")
            axs[5].plot(list(balance_db), label="balance dB")
            axs[5].plot(list(correlation), label="L/R corr")
            axs[5].legend(loc="upper right")

            plt.pause(0.001)


if __name__ == "__main__":
    asyncio.run(run())
