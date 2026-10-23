import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../context/AuthContext';

export default function ConditionPhotos({ deliveryId, stage, onReady, title = "Item condition photos" }) {
  const { api } = useAuth();
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/api/delivery/${deliveryId}/condition-photos`);
      setPhotos(data);
      onReady?.(data.some(photo => photo.stage === stage));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load condition photos.');
      onReady?.(false);
    }
  }, [api, deliveryId, stage, onReady]);
  useEffect(() => { load(); }, [load]);
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP photo, up to 5 MB.'); return;
    }
    setBusy(true);
    setError('');
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Cannot read this photo.'));
        reader.readAsDataURL(file);
      });
      await api.post(`/api/delivery/${deliveryId}/condition-photos`, { stage, image });
      await load();
    } catch (err) { setError(err.response?.data?.error || err.message || 'Upload failed. Please retry.'); }
    finally { setBusy(false); }
  };
  const visible = stage ? photos.filter(photo => photo.stage === stage) : photos;
  return <section className="rounded-xl border border-ink/10 bg-white p-4">
    <h3 className="font-semibold">{title}</h3>
    <p className="mt-1 text-xs leading-5 text-ink/65">{stage ? 'Photograph the item and any visible damage now. Save at least one photo before confirming this handover. Up to 3 photos; 5 MB each.' : 'Pickup and drop-off evidence is visible only to this delivery’s participants.'}</p>
    {stage && visible.length < 3 && <label className={`mt-3 inline-flex cursor-pointer rounded-lg bg-mesh-700 px-4 py-2 text-sm font-semibold text-white ${busy ? 'opacity-50' : ''}`}>
      {busy ? 'Uploading…' : 'Take or upload condition photo'}
      <input aria-label="Condition photo" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={upload}/>
    </label>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error} <button type="button" onClick={load} className="underline">Refresh photos</button></p>}
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">{visible.map(photo => <figure key={photo.id}>
      <a href={photo.url} target="_blank" rel="noreferrer"><img className="aspect-square w-full rounded-lg object-cover" src={photo.url} alt={`${photo.stage.replaceAll('_', ' ')} item condition`}/></a>
      <figcaption className="mt-1 text-xs text-ink/65">{photo.stage.replaceAll('_', ' ')} · {new Date(photo.created_at).toLocaleString()}</figcaption>
    </figure>)}</div>
    {stage && visible.length > 0 && <p className="mt-2 text-sm font-semibold text-mesh-700">Condition photo saved. You can confirm this handover.</p>}
    {!stage && !photos.length && !error && <p className="mt-2 text-sm text-ink/60">No condition photos recorded.</p>}
  </section>;
}
