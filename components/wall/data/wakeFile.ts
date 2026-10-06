import { Bytes, doc, getDoc, type Firestore } from 'firebase/firestore';
import type { WallWakeFile } from '@/types/schema';
import { joinWakeFile, wakeChunkDocId } from '@/utils/wall/wallSettings';

/** A custom wake word's .onnx, read back from its chunk docs (`wallSettings/wake-N`). */
export async function readWakeFile(db: Firestore, householdId: string, file: WallWakeFile): Promise<Uint8Array> {
  const snaps = await Promise.all(
    Array.from({ length: file.chunks }, (_, i) => getDoc(doc(db, `households/${householdId}/wallSettings/${wakeChunkDocId(i)}`)))
  );
  return joinWakeFile(
    file,
    snaps.map(snap => {
      const d = snap.data();
      if (!d) return undefined;
      const data: unknown = d['data'];
      return { id: d['id'], ...(data instanceof Bytes ? { data: data.toUint8Array() } : {}) };
    })
  );
}
