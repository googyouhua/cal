// Recording WebAudio double.
//
// The result-pause warning must be audible even when the offline voice engine is
// unavailable (file://, voice toggles off), so acceptance has to count what the
// page actually starts instead of listening. Nothing here makes sound: the
// double records every `oscillator.start()` and `bufferSource.start()`.
//
// Install order matters. `addInitScript` runs before the page's inline script,
// so the product sees this constructor as `window.AudioContext` from its first
// line. Init scripts accumulate across reloads (same as `seedSettings`), which
// is fine and keeps a seeded reload instrumented too.

async function installProbe() {
  const probe = { contexts: 0, instances: [], oscillatorStarts: [], bufferStarts: 0 };
  window.__audioProbe = probe;

  const createParam = (initial = 0) => {
    const param = {
      value: initial,
      defaultValue: initial,
      minValue: -3.4028234663852886e38,
      maxValue: 3.4028234663852886e38,
      automationRate: "a-rate",
      setValueAtTime(next) {
        param.value = Number(next);
        return param;
      },
      linearRampToValueAtTime(next) {
        param.value = Number(next);
        return param;
      },
      exponentialRampToValueAtTime(next) {
        param.value = Number(next);
        return param;
      },
      setTargetAtTime(next) {
        param.value = Number(next);
        return param;
      },
      setValueCurveAtTime() {
        return param;
      },
      cancelScheduledValues() {
        return param;
      },
      cancelAndHoldAtTime() {
        return param;
      },
    };
    return param;
  };

  const connectable = (node) => {
    node.connect = (target) => target;
    node.disconnect = () => {};
    return node;
  };

  const createOscillator = () => {
    const node = connectable({
      type: "sine",
      frequency: createParam(440),
      detune: createParam(0),
      onended: null,
      start(when = 0) {
        probe.oscillatorStarts.push({
          frequency: Number(node.frequency.value),
          type: String(node.type),
          when: Number(when) || 0,
        });
      },
      stop() {},
      setPeriodicWave() {},
    });
    return node;
  };

  const createGain = () => connectable({
    gain: createParam(1),
  });

  const createStereoPanner = () => connectable({
    pan: createParam(0),
  });

  const createBiquadFilter = () => connectable({
    type: "lowpass",
    frequency: createParam(350),
    detune: createParam(0),
    Q: createParam(1),
    gain: createParam(0),
    getFrequencyResponse() {},
  });

  const createBuffer = (channels = 1, length = 1, sampleRate = 44100) => {
    const channelCount = Math.max(1, Number(channels) || 1);
    const frameCount = Math.max(1, Number(length) || 1);
    const data = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
    return {
      numberOfChannels: channelCount,
      length: frameCount,
      sampleRate,
      duration: frameCount / sampleRate,
      getChannelData(channel) {
        return data[channel] || data[0];
      },
      copyToChannel(source, channel = 0) {
        (data[channel] || data[0]).set(source);
      },
      copyFromChannel(destination, channel = 0) {
        destination.set(data[channel] || data[0]);
      },
    };
  };

  const createBufferSource = () => connectable({
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    playbackRate: createParam(1),
    detune: createParam(0),
    onended: null,
    start() {
      probe.bufferStarts += 1;
    },
    stop() {},
  });

  const createConstantSource = () => connectable({
    offset: createParam(1),
    onended: null,
    start() {},
    stop() {},
  });

  const created = Date.now();

  class ProbeAudioContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 44100;
      this.baseLatency = 0;
      this.outputLatency = 0;
      this.onstatechange = null;
      this.destination = connectable({
        channelCount: 2,
        maxChannelCount: 2,
        numberOfInputs: 0,
        numberOfOutputs: 1,
      });
      probe.contexts += 1;
      probe.instances.push(this);
    }

    get currentTime() {
      return (Date.now() - created) / 1000;
    }

    resume() {
      this.state = "running";
      return Promise.resolve();
    }

    suspend() {
      this.state = "suspended";
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }

    createOscillator() {
      return createOscillator();
    }

    createGain() {
      return createGain();
    }

    createBuffer(...args) {
      return createBuffer(...args);
    }

    createBufferSource() {
      return createBufferSource();
    }

    createStereoPanner() {
      return createStereoPanner();
    }

    createBiquadFilter() {
      return createBiquadFilter();
    }

    createConstantSource() {
      return createConstantSource();
    }

    createAnalyser() {
      return connectable({ fftSize: 2048, frequencyBinCount: 1024, getByteTimeDomainData() {} });
    }

    decodeAudioData() {
      return Promise.resolve(createBuffer(1, 1, 44100));
    }
  }

  window.AudioContext = ProbeAudioContext;
  window.webkitAudioContext = ProbeAudioContext;
}

export async function installAudioProbe(app) {
  await app.context.addInitScript(installProbe);
  await app.page.reload({ waitUntil: "load" });
}

export async function audioProbe(page) {
  const snapshot = await page.evaluate(() => {
    const probe = window.__audioProbe;
    if (!probe) return null;
    return {
      contexts: probe.contexts,
      oscillatorStarts: probe.oscillatorStarts.map((entry) => ({
        frequency: entry.frequency,
        type: entry.type,
        when: entry.when,
      })),
      bufferStarts: probe.bufferStarts,
    };
  });
  if (!snapshot) {
    throw new Error("audio probe missing — call installAudioProbe(app) before the app script runs");
  }
  return snapshot;
}
