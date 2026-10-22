import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';

const EditListing = () => {
  const { api } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    category: 'Books',
    image_url: ''
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [readingPhoto, setReadingPhoto] = useState(false);

  const replacePhoto = async (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Choose a JPG, PNG or WebP photo up to 5 MB.');
      return;
    }
    setError('');
    setReadingPhoto(true);
    const reader = new FileReader();
    reader.onload = () => { setFormData(current => ({ ...current, image_url: reader.result })); setReadingPhoto(false); };
    reader.onerror = () => { setError('Could not read that photo. Please choose it again.'); setReadingPhoto(false); };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const fetchListing = async () => {
      try {
        const res = await api.get(`/listings/${id}`);
        const { title, description, price, category, image_url } = res.data;
        setFormData({
          title,
          description,
          price: Math.round(price),
          category,
          image_url: image_url || ''
        });
      } catch (err) {
        console.error(err);
        setError('Failed to load listing details');
      } finally {
        setFetching(false);
      }
    };
    fetchListing();
  }, [id, api]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.put(`/listings/${id}`, formData);
      navigate('/account/listings');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update listing');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return <div className="py-12 text-center">Loading listing details...</div>;
  }

  return (
    <div className="py-12">
      <div className="mx-auto max-w-[600px] space-y-4 rounded-2xl border border-ink/10 bg-white p-8">
        <h2 className="mb-6 text-2xl font-extrabold">Edit Listing</h2>

        {error && <div className="space-y-4">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Title</label>
            <input
              type="text"
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              placeholder="e.g. Calculus Textbook"
              required
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
            />
          </div>

          <div className="space-y-4">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Category</label>
            <select
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
            >
              <option value="Books">Books</option>
              <option value="Electronics">Electronics</option>
              <option value="Stationery">Stationery</option>
              <option value="Services">Services</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="space-y-4">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Price (₹)</label>
            <input
              type="number"
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              placeholder="e.g. 500"
              required
              min="0"
              value={formData.price}
              onChange={(e) => setFormData({...formData, price: e.target.value})}
            />
          </div>

          <div className="space-y-4">
            <label htmlFor="listing-cover" className="mb-1.5 block text-xs font-bold text-ink/60">Cover photo</label>
            {formData.image_url && <img src={formData.image_url} alt="Current listing cover" className="h-48 w-full rounded-xl bg-mesh-50 object-contain" />}
            <input
              id="listing-cover"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={loading || readingPhoto}
              className="w-full text-sm"
              onChange={(e) => replacePhoto(e.target.files?.[0])}
            />
            <p className="text-xs text-ink/50">JPG, PNG or WebP · up to 5 MB. Your new cover uploads when you save.</p>
          </div>

          <div className="space-y-4">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Description</label>
            <textarea
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              placeholder="Provide details about the item..."
              required
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
            />
          </div>

          <div className="flex gap-4">
            <button type="button" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-ink/10 bg-white px-5 text-sm font-bold text-ink transition hover:bg-ink/5" onClick={() => navigate('/account/listings')}>
              Cancel
            </button>
            <button type="submit" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white transition hover:bg-mesh-700 disabled:opacity-50" disabled={loading || readingPhoto}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditListing;
