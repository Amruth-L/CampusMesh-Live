import { useState, useRef, useEffect } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  ImagePlus,
  Info,
  IndianRupee,
  MapPin,
  Package,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { campusLocationLabel, normalizeCampusLocations } from '../lib/campus';

const DRAFT_STORAGE_KEY = 'campusmesh_listing_draft';

const AddListing = () => {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    category: 'Books',
    description: '',
    condition: 'Good',
    price: '',
    rentPrice: '',
    deposit: '',
    availability: 'Available Now',
    customDate: '',
    location: '',
    pickupLocationId: '',
    deliveryAvailable: false,
    deliveryCharge: '0',
    pickupTime: '5 min'
  });

  // Images state (holds base64 strings or ObjectUrls)
  const [images, setImages] = useState([]);
  const [coverIndex, setCoverIndex] = useState(0);

  // UI & Error States
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const [formValidationErrors, setFormValidationErrors] = useState([]);

  // Loading & Upload Progress States
  const [publishing, setPublishing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [campusLocations, setCampusLocations] = useState([]);

  // Restore a locally saved draft when the create-listing page is opened again.
  useEffect(() => {
    try {
      const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!savedDraft) return;

      const draft = JSON.parse(savedDraft);
      if (draft.formData) {
        setFormData((current) => ({ ...current, ...draft.formData }));
      }
      if (Array.isArray(draft.images)) setImages(draft.images);
      if (Number.isInteger(draft.coverIndex)) setCoverIndex(draft.coverIndex);
    } catch (draftError) {
      console.warn('Unable to restore listing draft:', draftError);
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/campus/locations')
      .then(({ data }) => {
        if (cancelled) return;
        const locationList = normalizeCampusLocations(data);
        setCampusLocations(locationList);
        setFormData((current) => {
          const selected = locationList.find((item) =>
            item.id === current.pickupLocationId ||
            campusLocationLabel(item) === current.location ||
            item.building_name === current.location,
          );
          return selected
            ? { ...current, pickupLocationId: selected.id, location: campusLocationLabel(selected) }
            : current;
        });
      })
      .catch(() => {
        // The fallback campus list below keeps the form usable if the campus API is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Dropdown options
  const categories = [
    'Books',
    'Electronics',
    'Stationery',
    'Lab Equipment',
    'Furniture',
    'Sports',
    'Kitchen',
    'Fashion',
    'Gaming',
    'Hostel Essentials'
  ];

  const conditions = ['Brand New', 'Like New', 'Excellent', 'Good', 'Fair'];
  const availabilities = ['Available Now', 'Available Tomorrow', 'Available This Weekend', 'Custom Date'];

  const fallbackLocations = [
    { id: 'library-ground-floor-rental-counter-02', name: 'Central Library' },
    { id: 'a-block-ground-floor-101', name: 'A-Block' },
    { id: 'hostel-ground-floor-204', name: 'Boys Hostel' },
    { id: 'girls-hostel', name: 'Girls Hostel' },
    { id: 'entrance', name: 'Main Entrance' },
  ];
  const locations = campusLocations.length ? campusLocations : fallbackLocations;
  const selectedLocation = locations.find((item) =>
    item.id === formData.pickupLocationId ||
    campusLocationLabel(item) === formData.location ||
    item.name === formData.location,
  );

  // Helper: Condition class name
  const getConditionClassName = (cond) => {
    return {
      'Brand New': 'border-blue-200 bg-blue-50 text-blue-700',
      'Like New': 'border-violet-200 bg-mesh-50 text-mesh-700',
      Excellent: 'border-mesh-200 bg-mesh-50 text-mesh-700',
      Good: 'border-amber-200 bg-amber-50 text-amber-700',
      Fair: 'border-orange-200 bg-orange-50 text-orange-700',
    }[cond] || 'border-ink/10 bg-ink/5 text-ink/60';
  };

  // Resize phone photos locally before previewing or sending them to the API.
  const preparePhoto = async (file) => {
    if (file.size > 40 * 1024 * 1024) {
      throw new Error(`${file.name} is too large to process. Choose a smaller photo.`);
    }
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 40_000_000) {
        throw new Error(`${file.name} has too many pixels. Choose a lower-resolution photo.`);
      }
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('This browser could not prepare the photo. Please try another image.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      let blob;
      for (const quality of [0.86, 0.76, 0.66, 0.56]) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob || blob.size <= 4.5 * 1024 * 1024) break;
      }
      if (!blob || blob.size > 4.5 * 1024 * 1024) {
        throw new Error(`${file.name} could not be reduced enough. Try a smaller photo.`);
      }
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`Could not read ${file.name}. Please try again.`));
        reader.readAsDataURL(blob);
      });
    } finally {
      bitmap.close?.();
    }
  };

  const handleFiles = async (files) => {
    setError('');
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    if (images.length + selectedFiles.length > 5) {
      setError('You can upload a maximum of 5 images.');
      return;
    }

    const acceptedFormats = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (selectedFiles.some((file) => !acceptedFormats.includes(file.type))) {
      setError('Choose a JPG, PNG, WebP, or HEIC photo.');
      return;
    }
    try {
      const prepared = [];
      for (const file of selectedFiles) prepared.push(await preparePhoto(file));
      setImages((current) => [...current, ...prepared].slice(0, 5));
    } catch (photoError) {
      setError(photoError.message || 'Could not prepare this photo. Please try again.');
    }
  };

  // Drag & Drop event handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (selected.length) handleFiles(selected);
  };

  const handleDeleteImage = (index) => {
    const updated = images.filter((_, idx) => idx !== index);
    setImages(updated);

    // Adjust cover index if deleted image was cover
    if (coverIndex === index) {
      setCoverIndex(0);
    } else if (coverIndex > index) {
      setCoverIndex(prev => prev - 1);
    }
  };

  const makeCover = (index) => {
    setCoverIndex(index);
  };

  // Form Validation
  const validateForm = () => {
    const errors = [];

    if (!formData.title.trim()) {
      errors.push('Product Title is required.');
    }
    if (!formData.category) {
      errors.push('Category is required.');
    }
    if (!formData.description.trim()) {
      errors.push('Description is required.');
    }
    if (formData.description.length > 500) {
      errors.push('Description must be 500 characters or less.');
    }
    if (images.length === 0) {
      errors.push('At least one product image is required.');
    }
    if (!formData.location) {
      errors.push('Pickup location is required.');
    }
    if (formData.deliveryAvailable && !(formData.pickupLocationId || selectedLocation?.id)) {
      errors.push('Choose a valid campus pickup location before enabling delivery.');
    }

    const sellPrice = parseFloat(formData.price) || 0;
    const rentPrice = parseFloat(formData.rentPrice) || 0;
    const deposit = parseFloat(formData.deposit) || 0;

    if (sellPrice <= 0 && rentPrice <= 0) {
      errors.push('You must specify either a Selling Price OR a Rental Price.');
    }
    if (sellPrice > 0 && deposit > sellPrice) {
      errors.push('Security deposit cannot exceed the selling price.');
    }

    setFormValidationErrors(errors);
    return errors.length === 0;
  };

  // Publish Form Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) {
      // Scroll to top to see validation errors
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setPublishing(true);
    setUploadProgress(25);
    setUploadStatus('Uploading your photos and publishing your item...');

    // Prepare API request payload
    const payload = {
      title: formData.title,
      description: formData.description,
      price: formData.price ? parseFloat(formData.price) : 0,
      category: formData.category,
      image_url: images[coverIndex] || '', // Primary cover image
      condition: formData.condition,
      rent_price: formData.rentPrice ? parseFloat(formData.rentPrice) : 0,
      deposit: formData.deposit ? parseFloat(formData.deposit) : 0,
      location: formData.location,
      pickup_location_id: formData.pickupLocationId || selectedLocation?.id || null,
      delivery_available: formData.deliveryAvailable,
      delivery_charge: formData.deliveryAvailable ? parseFloat(formData.deliveryCharge) : 0,
      pickup_time: formData.deliveryAvailable ? formData.pickupTime : '5 min',
      image_urls: images // Array of all uploaded images
    };

    try {
      await api.post('/listings', payload);

      setUploadProgress(100);
      setUploadStatus('Published successfully!');
      localStorage.removeItem(DRAFT_STORAGE_KEY);

      alert('Your listing has been published successfully.');
      navigate('/account/listings');
    } catch (err) {
      setPublishing(false);
      setError(err.response?.data?.error || 'Failed to publish listing. Please try again.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSaveDraft = () => {
    const draft = {
      formData,
      images,
      coverIndex,
      savedAt: new Date().toISOString()
    };

    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      alert('Draft saved successfully. You can continue it later.');
    } catch (storageError) {
      // Large base64 images can exceed the browser's localStorage quota. Keep
      // the form fields so the draft is still useful, even if images cannot be
      // stored locally.
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
          formData,
          coverIndex,
          savedAt: new Date().toISOString()
        }));
        alert('Draft details saved. The images were too large to save locally, so please select them again later.');
      } catch (fallbackError) {
        console.error('Unable to save listing draft:', storageError, fallbackError);
        setError('Unable to save the draft in this browser. Please try again or use smaller images.');
      }
    }
  };

  // Mock safety values
  const sellerRating = user?.rating || 4.8;
  const sellerMeshScore = user?.meshScore || 98;
  const sellerDept = user?.department || 'Computer Science';
  const sellerSem = user?.semester || 6;
  const sellerInitials = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <main className="min-h-screen bg-paper pb-20">

      {/* Loading/Publishing Overlay Screen */}
      {publishing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-5 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-ink/10 bg-white p-7 text-center shadow-[0_22px_70px_rgba(35,58,40,.16)]">
            <div className="mx-auto size-10 animate-spin rounded-full border-4 border-mesh-100 border-t-mesh-600" />
            <h2 className="mt-5 text-xl font-semibold">Publishing listing</h2>
            <p className="mt-2 text-sm text-ink/50">{uploadStatus}</p>
            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-mesh-50 ring-1 ring-inset ring-ink/10">
              <progress className="h-full w-full accent-mesh-600" value={uploadProgress} max="100" />
            </div>
            <div className="mt-2 text-xs font-semibold text-ink/50">
              {uploadProgress}% Complete
            </div>
          </div>
        </div>
      )}

      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 py-9 sm:px-7 sm:py-12 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div>
            <button
              type="button"
              onClick={() => navigate('/lend')}
              className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-ink/45 transition hover:text-mesh-700"
            >
              <ArrowLeft size={14} /> Back to listing dashboard
            </button>
            <span className="flex items-center gap-1.5 text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">
              <Package size={14} /> Lend
            </span>
            <h1 className="page-title mt-3">
              List an item
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/50">
              Add photos, a daily price, and a pickup location.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-mesh-900/10 bg-white/80 px-3 py-2 text-xs font-bold text-mesh-700 lg:self-auto">
            <BadgeCheck size={15} /> Free to list
          </div>
        </div>
      </header>

      {/* Validation Errors Header Banner */}
      {formValidationErrors.length > 0 && (
        <div className="mx-auto mt-6 flex w-full max-w-[1240px] gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-red-800 sm:px-5">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <div>
            <h4 className="font-semibold">Please resolve the following:</h4>
            <ul className="mt-2 list-disc space-y-1 pl-5">
            {formValidationErrors.map((err, idx) => (
              <li key={idx} className="mb-0.5 text-sm">{err}</li>
            ))}
            </ul>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-auto mt-6 flex w-full max-w-[1240px] items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-bold text-red-800 sm:px-5">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} onDragEnter={handleDrag} className="mx-auto grid w-full max-w-[1240px] gap-6 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-10 lg:py-9">
        <div className="min-w-0 space-y-5">

        {/* SECTION 1 - ITEM DETAILS */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-mesh-50 text-mesh-700"><Package size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 1</span>
              <h2 className="mt-0.5 text-lg font-semibold">Item details</h2>
            </div>
          </div>

          <div className="space-y-5">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Product Title *</label>
            <input
              type="text"
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              placeholder="e.g. MacBook Air M1"
              required
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
            />
          </div>

          <div className="space-y-5">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Category *</label>
            <select
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div className="space-y-5">
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-bold text-ink/60">Description *</label>
              <span className={`text-xs font-medium ${formData.description.length > 500 ? 'text-red-600' : formData.description.length > 450 ? 'text-amber-600' : 'text-ink/45'}`}>
                {formData.description.length} / 500 characters
              </span>
            </div>
            <textarea
              className="min-h-28 w-full resize-y rounded-xl border border-ink/15 bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              placeholder="Condition and what is included"
              required
              maxLength={520}
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value.slice(0, 500)})}
              rows={4}
            />
          </div>
        </section>

        {/* SECTION 2 - CONDITION */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><BadgeCheck size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 2</span>
              <h2 className="mt-0.5 text-lg font-semibold">Condition</h2>
            </div>
          </div>

          <div className="space-y-3">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Item Condition *</label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100 sm:w-64"
                value={formData.condition}
                onChange={(e) => setFormData({...formData, condition: e.target.value})}
              >
                {conditions.map(cond => (
                  <option key={cond} value={cond}>{cond}</option>
                ))}
              </select>
              <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${getConditionClassName(formData.condition)}`}>
                {formData.condition}
              </span>
            </div>
          </div>
        </section>

        {/* SECTION 3 - PRICING */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><IndianRupee size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 3</span>
              <h2 className="mt-0.5 text-lg font-semibold">Pricing & availability</h2>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <div className="space-y-2">
              <label className="mb-1.5 block text-xs font-bold text-ink/60">Selling Price (₹)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink/40">₹</span>
                <input
                  type="number"
                  className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 pl-9 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="0"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({...formData, price: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="mb-1.5 block text-xs font-bold text-ink/60">Rental Price per Day (₹)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink/40">₹</span>
                <input
                  type="number"
                  className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 pl-9 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="0"
                  min="0"
                  value={formData.rentPrice}
                  onChange={(e) => setFormData({...formData, rentPrice: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="mb-1.5 block text-xs font-bold text-ink/60">Security Deposit (₹)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink/40">₹</span>
                <input
                  type="number"
                  className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 pl-9 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="0"
                  min="0"
                  value={formData.deposit}
                  onChange={(e) => setFormData({...formData, deposit: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-ink/60"><CalendarDays size={14} /> Availability timeframe</label>
              <select
                className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                value={formData.availability}
                onChange={(e) => setFormData({...formData, availability: e.target.value})}
              >
                {availabilities.map(av => (
                  <option key={av} value={av}>{av}</option>
                ))}
              </select>
            </div>

            {formData.availability === 'Custom Date' && (
              <div className="space-y-2">
                <label className="mb-1.5 block text-xs font-bold text-ink/60">Select Availability Date</label>
                <input
                  type="date"
                  className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  value={formData.customDate}
                  onChange={(e) => setFormData({...formData, customDate: e.target.value})}
                />
              </div>
            )}
          </div>
        </section>

        {/* SECTION 4 - ITEM IMAGES */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-mesh-50 text-mesh-700"><Camera size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 4</span>
              <h2 className="mt-0.5 text-lg font-semibold">Item images</h2>
            </div>
          </div>

          <p className="mb-4 text-sm leading-6 text-ink/50">
            Upload up to 5 clear images showing the actual condition of the item. Your first image will be the cover.
          </p>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
          />
          <input
            type="file"
            ref={cameraInputRef}
            onChange={handleFileChange}
            accept="image/*"
            capture="environment"
            className="hidden"
          />

          <div
            className={`grid min-h-36 place-items-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition sm:min-h-40 sm:px-5 ${dragActive ? 'border-mesh-500 bg-mesh-50' : 'border-mesh-200 bg-mesh-50/40'}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <ImagePlus className="text-mesh-600" size={34} />
            <div className="mt-3 space-y-1 text-center">
              <h3 className="font-semibold">Add photos of your item</h3>
              <p className="text-xs leading-5 text-ink/55">Up to 5 photos. Large phone photos are resized automatically.</p>
            </div>
            <div className="mt-4 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
              <button type="button" onClick={() => cameraInputRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-mesh-700 px-4 text-sm font-semibold text-white hover:bg-mesh-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mesh-700">
                <Camera size={17} /> Take a photo
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-4 text-sm font-semibold text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mesh-700">
                <ImagePlus size={17} /> Choose from device
              </button>
            </div>
          </div>

          {images.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {images.map((img, idx) => (
                <div key={idx} className="group relative aspect-square overflow-hidden rounded-2xl border border-ink/10 bg-ink/5 shadow-sm">
                  <img src={img} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />

                  {idx === coverIndex && (
                    <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-mesh-600 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"><Check size={11} /> Cover</span>
                  )}

                  <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-ink/55 opacity-0 transition group-hover:opacity-100">
                    {idx !== coverIndex && (
                      <button
                        type="button"
                        className="grid size-9 place-items-center rounded-xl border border-white/30 bg-white text-ink/60 transition hover:bg-mesh-50"
                        onClick={() => makeCover(idx)}
                        title="Make Cover Image"
                      >
                        <Star size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="grid size-9 place-items-center rounded-xl border border-white/30 bg-white text-red-600 transition hover:bg-red-50"
                      onClick={() => handleDeleteImage(idx)}
                      title="Delete Image"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 5 - PICKUP LOCATION */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-700"><MapPin size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 5</span>
              <h2 className="mt-0.5 text-lg font-semibold">Pickup location</h2>
            </div>
          </div>

          <div className="space-y-2">
            <label className="mb-1.5 block text-xs font-bold text-ink/60">Select On-Campus Pickup Location *</label>
            <select
              className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
              value={formData.pickupLocationId || selectedLocation?.id || ''}
              onChange={(e) => {
                const selected = locations.find((item) => item.id === e.target.value);
                setFormData({
                  ...formData,
                  pickupLocationId: e.target.value,
                  location: selected ? campusLocationLabel(selected) : '',
                });
              }}
              required
            >
              <option value="">-- Choose a location --</option>
              {locations.map(loc => (
                <option key={loc.id || loc.name} value={loc.id || loc.name}>
                  {campusLocationLabel(loc)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* SECTION 6 - DELIVERY */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Truck size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 6</span>
              <h2 className="mt-0.5 text-lg font-semibold">Delivery settings</h2>
            </div>
          </div>

          <div className={`flex items-start gap-3 rounded-2xl border p-4 ${formData.deliveryAvailable ? 'border-mesh-200 bg-mesh-50' : 'border-ink/10 bg-ink/[.02]'}`}>
            <input
              type="checkbox"
              id="delivery-check"
              checked={formData.deliveryAvailable}
              onChange={(e) => setFormData({...formData, deliveryAvailable: e.target.checked})}
              className="mt-0.5 size-[18px] cursor-pointer accent-mesh-600"
            />
            <div>
              <label htmlFor="delivery-check" className="cursor-pointer text-sm font-semibold">Student courier delivery</label>
              <p className="mt-1 text-xs leading-5 text-ink/45">Let matched couriers bring your item to another campus location.</p>
            </div>
          </div>

          {formData.deliveryAvailable && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="mb-1.5 block text-xs font-bold text-ink/60">Delivery Charge (₹)</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink/40">₹</span>
                  <input
                    type="number"
                    className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 pl-9 text-sm outline-none focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                    placeholder="0"
                    min="0"
                    value={formData.deliveryCharge}
                    onChange={(e) => setFormData({...formData, deliveryCharge: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="mb-1.5 block text-xs font-bold text-ink/60">Estimated Courier Pickup Time</label>
                <input
                  type="text"
                  className="h-11 w-full rounded-xl border border-ink/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                  placeholder="e.g. 10 - 20 mins"
                  value={formData.pickupTime}
                  onChange={(e) => setFormData({...formData, pickupTime: e.target.value})}
                />
              </div>
            </div>
          )}
        </section>

        {/* SECTION 7 - CONTACT */}
        <section className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)] sm:p-7">
          <div className="mb-6 flex items-center gap-3 border-b border-ink/10 pb-4">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><UserRound size={19} /></span>
            <div>
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-600">Step 7</span>
              <h2 className="mt-0.5 text-lg font-semibold">Seller contact</h2>
            </div>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-mesh-200 bg-mesh-50 p-4 sm:flex-row sm:items-center">
            <div className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-white bg-mesh-600 text-xl font-semibold text-white shadow-sm">
              {sellerInitials}
            </div>
            <div className="grid gap-1 text-sm text-ink/55">
              <h3 className="font-semibold text-ink">{user?.name || 'Anonymous Student'}</h3>
              <p>{user?.email}</p>
              <p className="text-ink/50">
                {sellerDept} • Semester {sellerSem}
              </p>

              <div className="mt-1 flex flex-wrap gap-4 text-xs font-bold">
                <span className="flex items-center gap-1 text-amber-600"><Star size={13} fill="currentColor" /> Rating: {sellerRating}</span>
                <span className="flex items-center gap-1 text-mesh-700"><ShieldCheck size={13} /> Trust score: {sellerMeshScore}</span>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 8 - SAFETY NOTICE */}
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <Info className="mt-0.5 shrink-0 text-amber-700" size={19} />
          <div className="text-sm">
            <h3 className="font-semibold">Safety & accuracy</h3>
            <p className="mt-1 leading-6 text-amber-900/70">
              Upload real images of the item in your possession. Make sure the condition in your description matches the photos.
            </p>
          </div>
        </div>

        {/* SECTION 9 - ACTION BUTTONS */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={() => navigate('/lend')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-5 text-sm font-bold text-ink transition hover:border-mesh-500 hover:bg-mesh-50"
          >
            <X size={16} /> Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-5 text-sm font-bold text-ink transition hover:border-mesh-500 hover:bg-mesh-50"
          >
            <Save size={16} /> Save draft
          </button>
          <button
            type="button"
            onClick={() => {
              if (validateForm()) {
                alert(`--- PREVIEW DETAILS ---\n\nTitle: ${formData.title}\nCategory: ${formData.category}\nCondition: ${formData.condition}\nSell Price: ₹${formData.price || 0}\nRent Rate: ₹${formData.rentPrice || 0}/day\nPickup: ${formData.location}\n\nPress Publish to publish it!`);
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white px-5 text-sm font-bold text-ink transition hover:border-mesh-500 hover:bg-mesh-50"
          >
            Preview Listing
          </button>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-6 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0"
          >
            <Check size={16} /> Publish listing
          </button>
        </div>

        </div>

        <aside className="hidden space-y-5 lg:block">
          <div className="sticky top-24 space-y-5">
            <div className="rounded-3xl border border-mesh-900/10 bg-ink p-5 text-white shadow-[0_10px_40px_rgba(35,58,40,.10)]">
              <span className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-mesh-300">Listing checklist</span>
              <h2 className="mt-2 text-xl font-semibold">Before you publish</h2>
              <ul className="mt-5 space-y-4 text-sm text-white/70">
                <li className="flex gap-3"><Check className="mt-0.5 shrink-0 text-mesh-300" size={16} /> Use a clear, specific title.</li>
                <li className="flex gap-3"><Check className="mt-0.5 shrink-0 text-mesh-300" size={16} /> Show the actual item in good light.</li>
                <li className="flex gap-3"><Check className="mt-0.5 shrink-0 text-mesh-300" size={16} /> Add one price for selling or renting.</li>
                <li className="flex gap-3"><Check className="mt-0.5 shrink-0 text-mesh-300" size={16} /> Choose the exact pickup point.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-mesh-900/10 bg-white p-5 shadow-[0_10px_40px_rgba(35,58,40,.06)]">
              <div className="flex items-center gap-2 text-mesh-700"><ShieldCheck size={18} /><b className="text-sm">Student-to-student safe</b></div>
              <p className="mt-2 text-xs leading-5 text-ink/50">Your contact details stay tied to your account and are shown only as needed for a confirmed rental.</p>
            </div>
          </div>
        </aside>

      </form>
    </main>
  );
};

export default AddListing;
