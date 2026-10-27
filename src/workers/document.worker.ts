/// <reference lib="webworker" />
import { extractDocument, type DocumentKind } from '../text/import';

type Request = { type: 'extract'; id: number; kind: DocumentKind; data: ArrayBuffer };
const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  if (!request || request.type !== 'extract' || !Number.isInteger(request.id) || !(request.data instanceof ArrayBuffer) || (request.kind !== 'docx' && request.kind !== 'pdf')) return;
  void extractDocument(request.kind, request.data).then(
    (document) => worker.postMessage({ type: 'result', id: request.id, document }),
    (error) => worker.postMessage({ type: 'error', id: request.id, message: error instanceof Error ? error.message : 'The document could not be extracted.' }),
  );
};
