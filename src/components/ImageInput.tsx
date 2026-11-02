import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { isSupportedImageFile, validateImageFile } from '../image/loadImage';
import { documentFileKind, validateDocumentFile } from '../text/import';

type ImageInputProps = {
  onFile: (file: File) => Promise<void>;
  variant: 'toolbar' | 'dropzone';
  children?: ReactNode;
  sourceType?: 'artwork' | 'document';
  browseOnClick?: boolean;
};

function containsFiles(event: globalThis.DragEvent | DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function ImageInput({ onFile, variant, children, sourceType = 'artwork', browseOnClick = !children }: ImageInputProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptRequest = useRef(0);

  useEffect(() => {
    acceptRequest.current += 1;
    setError(null);
    setBusy(false);
    setDragActive(false);
    dragDepth.current = 0;
    return () => { acceptRequest.current += 1; };
  }, [sourceType]);

  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (containsFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const accept = async (files: FileList | File[]) => {
    const requestId = acceptRequest.current + 1;
    acceptRequest.current = requestId;
    setDragActive(false);
    dragDepth.current = 0;
    if (files.length !== 1) {
      setBusy(false);
      setError(`Choose exactly one ${sourceType === 'document' ? 'document' : 'image or SVG'} at a time.`);
      return;
    }
    const file = files[0];
    try {
      if (sourceType === 'document') validateDocumentFile(file); else validateImageFile(file);
      setBusy(true);
      setError(null);
      await onFile(file);
    } catch (reason) {
      if (requestId === acceptRequest.current) setError(reason instanceof Error ? reason.message : 'The image or SVG could not be loaded.');
    } finally {
      if (requestId === acceptRequest.current) setBusy(false);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files?.length) void accept(files);
    event.currentTarget.value = '';
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    const item = event.dataTransfer.items[0];
    setDragActive(!item?.type || (sourceType === 'document' ? Boolean(documentFileKind({ name: '', type: item.type })) : isSupportedImageFile({ name: '', type: item.type })));
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragActive(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void accept(event.dataTransfer.files);
  };

  const input = <input ref={inputRef} aria-label={sourceType === 'document' ? 'Choose DOCX or PDF' : 'Choose image or SVG'} type="file" accept={sourceType === 'document' ? 'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx,.doc' : 'image/png,image/jpeg,image/webp,image/svg+xml,.jpg,.jpeg,.svg'} onChange={onChange} disabled={busy}/>;
  if (variant === 'toolbar') return <div className="image-input"><button type="button" className="upload" aria-busy={busy} disabled={busy} onClick={() => inputRef.current?.click()}><Upload aria-hidden="true" size={16}/>{busy ? 'Loading…' : sourceType === 'document' ? 'Import document' : 'Import source'}</button>{input}{error&&<span className="upload-error" role="alert">{error}</span>}</div>;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); }
  };
  return <div className="drop-container"><div role={browseOnClick ? 'button' : undefined} tabIndex={browseOnClick ? 0 : undefined} className={`drop ${dragActive ? 'drag-active' : ''} ${children ? 'has-content' : ''}`} onClick={browseOnClick ? (event)=>{if(event.target!==inputRef.current)inputRef.current?.click()} : undefined} onKeyDown={browseOnClick ? onKeyDown : undefined} onDragEnter={onDragEnter} onDragOver={(event)=>event.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop} aria-busy={busy}>{children ?? <><Upload aria-hidden="true" size={34}/><b>{busy ? 'Loading file…' : sourceType === 'document' ? 'Drop a DOCX or text PDF, or type text in the sidebar' : 'Drop an image or SVG, or click to browse'}</b><span>{sourceType === 'document' ? 'DOCX or text-based PDF — extracted locally in your browser' : 'PNG, JPEG, WebP, or SVG — processed entirely in your browser'}</span></>}{input}</div>{error&&<span className="drop-error" role="alert">{error}</span>}</div>;
}
