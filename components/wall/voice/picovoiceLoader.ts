import { CHEETAH_MODEL_URL, DEVICE_ENDPOINT_SEC, PORCUPINE_MODEL_URL, type PicovoiceLib } from './deviceEngine';

/**
 * Picovoice's packages behind deviceEngine's `PicovoiceLib` seam. Its own
 * module so the WebAssembly packages load only on a wall that listens, and
 * so tests (which inject a fake lib) never resolve them.
 */
export async function loadPicovoice(): Promise<PicovoiceLib> {
  const [{ CheetahWorker }, { PorcupineWorker, BuiltInKeyword }, { WebVoiceProcessor }] = await Promise.all([
    import('@picovoice/cheetah-web'),
    import('@picovoice/porcupine-web'),
    import('@picovoice/web-voice-processor'),
  ]);
  return {
    createCheetah: (accessKey, onTranscript, onError) =>
      CheetahWorker.create(
        accessKey,
        onTranscript,
        { publicPath: CHEETAH_MODEL_URL, customWritePath: 'cheetah_v4_2', version: 1 },
        { endpointDurationSec: DEVICE_ENDPOINT_SEC, enableAutomaticPunctuation: true, processErrorCallback: onError }
      ),
    createPorcupine: (config, onWake, onError) => {
      const builtin = Object.values(BuiltInKeyword).find(k => k === config.keyword);
      const keyword =
        config.keyword === 'custom' && config.ppn
          ? { base64: config.ppn, label: config.label, sensitivity: config.sensitivity }
          : { builtin: builtin ?? BuiltInKeyword.Computer, sensitivity: config.sensitivity };
      return PorcupineWorker.create(config.accessKey, [keyword], () => onWake(), {
        publicPath: PORCUPINE_MODEL_URL,
        customWritePath: 'porcupine_v4',
        version: 1,
      }, { processErrorCallback: onError });
    },
    subscribe: engine => WebVoiceProcessor.subscribe(engine),
    unsubscribe: engine => WebVoiceProcessor.unsubscribe(engine),
  };
}
