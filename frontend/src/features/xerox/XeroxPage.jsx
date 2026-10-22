import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  CheckCircle2,
  FileLock2,
  FileText,
  IndianRupee,
  PackageCheck,
  Printer,
  ShieldCheck,
  Truck,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { openRazorpayCheckout } from "../../utils/RazorpayService";
import { campusLocationLabel, normalizeCampusLocations } from "../../lib/campus";

const human = (value) =>
  String(value || "received")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
const stages = [
  "RECEIVED",
  "PRINTING",
  "READY_FOR_COURIER",
  "COURIER_ASSIGNED",
  "IN_TRANSIT",
  "COMPLETED",
];
function Timeline({ status }) {
  const current = Math.max(0, stages.indexOf(status));
  return (
    <div className="mt-4 flex items-center">
      {stages.map((stage, index) => (
        <div key={stage} className="flex flex-1 items-center last:flex-none">
          <span
            title={human(stage)}
            className={`grid size-6 place-items-center rounded-full text-[9px] font-extrabold ${index <= current ? "bg-mesh-600 text-white" : "bg-ink/10 text-ink/30"}`}
          >
            {index < current ? <CheckCircle2 size={13} /> : index + 1}
          </span>
          {index < stages.length - 1 && (
            <span
              className={`h-0.5 flex-1 ${index < current ? "bg-mesh-500" : "bg-ink/10"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
export default function XeroxRequest() {
  const { api, user } = useAuth();
  const desk = user?.account_type === "XEROX_DESK";
  const [file, setFile] = useState();
  const [copies, setCopies] = useState(1);
  const [locations, setLocations] = useState([]);
  const [drop, setDrop] = useState("");
  const [preview, setPreview] = useState();
  const [orders, setOrders] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [locationResult, orderResult] = await Promise.allSettled([
      api.get("/api/campus/locations"),
      api.get(desk ? "/api/xerox/desk/requests" : "/api/xerox/requests/mine"),
    ]);

    if (locationResult.status === "fulfilled") {
      const locationList = normalizeCampusLocations(locationResult.value.data);
      setLocations(locationList);
      setDrop(
        (current) =>
          (locationList.some((item) => item.id === current) && current) ||
          locationList.find((item) => item.building_id === "hostel")?.id ||
          locationList[0]?.id ||
          "",
      );
    } else {
      throw locationResult.reason;
    }

    if (orderResult.status === "fulfilled") {
      const orderList = Array.isArray(orderResult.value.data)
        ? orderResult.value.data
        : orderResult.value.data?.orders || [];
      setOrders(orderList);
    } else if (locationResult.status === "fulfilled") {
      setNotice(orderResult.reason?.response?.data?.error || "Could not load print requests.");
    }
  }, [api, desk]);
  useEffect(() => {
    load().catch((error) =>
      setNotice(error.response?.data?.error || "Could not load Xerox service."),
    );
  }, [load]);
  const inspect = async (selected) => {
    setFile(selected);
    setPreview();
    if (!selected) return;
    if (selected.type !== "application/pdf")
      return setNotice("Choose a PDF file.");
    if (selected.size > 15 * 1024 * 1024)
      return setNotice("The PDF must be 15 MB or smaller.");
    setBusy(true);
    try {
      const { data } = await api.post("/api/xerox/preview", selected, {
        headers: { "Content-Type": "application/pdf", "X-Copies": copies },
      });
      setPreview(data);
      setNotice("PDF validated. Only the Xerox Desk can open it.");
    } catch (error) {
      setNotice(error.response?.data?.error || "PDF validation failed.");
    } finally {
      setBusy(false);
    }
  };
  const completeRequest = async (paymentOrderId) => {
    await api.post("/api/xerox/requests", file, {
      headers: {
        "Content-Type": "application/pdf",
        "X-Copies": copies,
        "X-Drop-Location": drop,
        "X-Filename": encodeURIComponent(file.name),
        "X-Payment-Order-Id": paymentOrderId,
      },
    });
    setNotice("Payment received. Print request queued.");
    setFile(undefined);
    setPreview(undefined);
    await load();
  };
  const submit = async () => {
    if (!file || !drop || !preview) return;
    setBusy(true);
    setNotice("");
    try {
      const { data: order } = await api.post("/api/payment/create-xerox-order", {
        page_count: preview.pageCount,
        copies: preview.copies,
        drop_location_id: drop,
        document_hash: preview.sha256,
        filename: file.name,
      });
      if (order.simulated) {
        await api.post("/api/payment/verify-xerox", {
          gateway_order_id: order.order_id,
          gateway_payment_id: "sim_xerox_" + Date.now(),
          gateway_signature: "sim_sig",
        });
        await completeRequest(order.order_id);
        setBusy(false);
        return;
      }
      await openRazorpayCheckout({
        key: order.razorpay_key,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "CampusMesh",
        description: "Xerox printing and campus delivery",
        order_id: order.order_id,
        prefill: { name: user?.name, email: user?.email, contact: user?.phone_number },
        handler: async (response) => {
          try {
            await api.post("/api/payment/verify-xerox", {
              gateway_order_id: response.gateway_order_id || order.order_id,
              gateway_payment_id: response.gateway_payment_id,
              gateway_signature: response.gateway_signature,
            });
            await completeRequest(order.order_id);
          } catch (error) {
            setNotice(error.response?.data?.error || "Payment verification failed. Please try again.");
          } finally {
            setBusy(false);
          }
        },
        modalDismissHandler: () => setBusy(false),
      });
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not initialize payment.");
      setBusy(false);
    }
  };
  const action = async (id, name) => {
    try {
      await api.post(`/api/xerox/${id}/${name}`);
      setNotice(
        name === "ready"
          ? "Printout released for private courier matching."
          : "Request moved to printing.",
      );
      await load();
    } catch (error) {
      setNotice(error.response?.data?.error || "Could not update request.");
    }
  };
  const view = async (id) => {
    const response = await api.get(`/api/xerox/${id}/document`, {
      responseType: "blob",
    });
    window.open(
      URL.createObjectURL(response.data),
      "_blank",
      "noopener,noreferrer",
    );
  };
  if (desk)
    return (
      <main className="min-h-screen bg-paper">
        <header className="border-b border-ink/10">
          <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-10">
            <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 flex items-center gap-1">
              <FileLock2 size={14} /> Authorized desk workspace
            </span>
            <h1 className="mt-3 font-display text-5xl font-semibold">
              Private print queue.
            </h1>
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-7">
          {notice && (
            <p className="mb-5 rounded-2xl bg-mesh-50 p-4 text-sm font-bold text-mesh-800">
              {notice}
            </p>
          )}
          <div className="space-y-4">
            {orders.map((order) => (
              <motion.article
                layout
                key={order.id}
                className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] grid gap-4 p-5 md:grid-cols-[auto_1fr_auto]"
              >
                <span className="grid size-12 place-items-center rounded-2xl bg-violet-50 text-violet-700">
                  <FileText />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-extrabold">
                      {order.original_filename}
                    </h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-900/10 bg-white/80 px-3 py-1 text-xs font-bold text-mesh-700">{human(order.status)}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink/50">
                    {order.requester_name} · {order.page_count} pages ×{" "}
                    {order.copies} copies · ₹{order.total_amount}
                  </p>
                  <Timeline status={order.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => view(order.id)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-mesh-900/15 bg-white px-5 text-sm font-bold text-ink transition hover:-translate-y-0.5 hover:border-mesh-500 hover:bg-mesh-50"
                  >
                    <FileLock2 size={15} /> Private PDF
                  </button>
                  {order.status === "RECEIVED" && (
                    <button
                      onClick={() => action(order.id, "print")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Start printing
                    </button>
                  )}
                  {["RECEIVED", "PRINTING"].includes(order.status) && (
                    <button
                      onClick={() => action(order.id, "ready")}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                    >
                      Mark ready
                    </button>
                  )}
                </div>
              </motion.article>
            ))}
            {!orders.length && (
              <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] py-20 text-center">
                <Printer className="mx-auto text-ink/20" />
                <h2 className="mt-3 font-extrabold">The queue is clear</h2>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-paper pb-16">
      <header className="border-b border-ink/10 bg-[radial-gradient(circle_at_80%_0%,rgba(130,92,224,.10),transparent_28%)]">
        <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 py-10">
          <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 flex items-center gap-1">
            <Printer size={14} /> Campus print service
          </span>
          <h1 className="mt-3 font-display text-5xl font-semibold">
            Upload. Print. Delivered.
          </h1>
          <p className="mt-3 text-ink/50">Private printing · ₹3/page</p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1240px] px-5 sm:px-7 lg:px-10 grid gap-6 py-7 lg:grid-cols-[1fr_.8fr]">
        <section className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] p-5 sm:p-7">
          <label className="grid cursor-pointer place-items-center rounded-3xl border-2 border-dashed border-mesh-300 bg-mesh-50/50 px-5 py-12 text-center transition hover:border-mesh-500 hover:bg-mesh-50">
            <input
              className="sr-only"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => inspect(event.target.files[0])}
            />
            <UploadCloud className="text-mesh-700" size={34} />
            <b className="mt-4">{file?.name || "Drop or choose one PDF"}</b>
            <span className="mt-1 text-xs text-ink/40">
              PDF only · up to 15 MB
            </span>
          </label>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-1 block">Copies</span>
              <input
                className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                type="number"
                min="1"
                max="20"
                value={copies}
                onChange={(event) => {
                  setCopies(Number(event.target.value));
                  if (file) inspect(file);
                }}
              />
            </label>
            <label>
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600 mb-1 block">Deliver to</span>
              <select
                className="h-11 w-full rounded-xl border border-mesh-900/15 bg-white px-3 text-sm outline-none transition focus:border-mesh-500 focus:ring-4 focus:ring-mesh-100"
                value={drop}
                onChange={(event) => setDrop(event.target.value)}
              >
                <option value="" disabled>Choose campus location</option>
                {locations.length ? locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {campusLocationLabel(item)}
                  </option>
                )) : <option value="" disabled>No campus locations available</option>}
              </select>
            </label>
          </div>
          {preview && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 flex items-center gap-4 rounded-2xl bg-ink p-5 text-white"
            >
              <FileText />
              <div className="flex-1">
                <b>
                  {preview.pageCount} pages × {preview.copies} copies
                </b>
                <p className="text-xs text-white/50">
                  {preview.pageCount} × {preview.copies} × ₹3
                </p>
              </div>
              <strong className="flex items-center text-xl">
                <IndianRupee size={18} />
                {preview.totalAmount}
              </strong>
            </motion.div>
          )}
          <button
            disabled={!preview || busy}
            onClick={submit}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-mesh-700 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 mt-5 w-full disabled:opacity-40"
          >
            {busy ? "Working…" : preview ? "Pay ₹" + preview.totalAmount + " & print" : "Pay & print"}
          </button>
          <p className="mt-4 flex items-center justify-center gap-1 text-xs text-ink/45">
            <ShieldCheck size={14} className="text-mesh-600" />
            Couriers never receive PDF access.
          </p>
          {notice && (
            <p className="mt-4 rounded-xl bg-mesh-50 p-3 text-sm font-bold text-mesh-800">
              {notice}
            </p>
          )}
        </section>
        <aside>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">Live progress</span>
              <h2 className="mt-1 text-xl font-extrabold">
                Your print requests
              </h2>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-900/10 bg-white/80 px-3 py-1 text-xs font-bold text-mesh-700">{orders.length}</span>
          </div>
          <div className="space-y-3">
            {orders.map((order) => (
              <article key={order.id} className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                    <FileText size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate">{order.original_filename}</b>
                    <p className="mt-1 text-xs text-ink/45">
                      {order.page_count} pages · {order.copies} copies · ₹
                      {order.total_amount}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-mesh-900/10 bg-white/80 px-3 py-1 text-xs font-bold text-mesh-700">{human(order.status)}</span>
                </div>
                <Timeline status={order.status} />
                <p className="mt-3 flex items-center gap-1 text-xs font-bold text-ink/45">
                  {["IN_TRANSIT", "COURIER_ASSIGNED"].includes(order.status) ? (
                    <>
                      <Truck size={14} />
                      Courier delivery active
                    </>
                  ) : (
                    <>
                      <PackageCheck size={14} />
                      Secure desk processing
                    </>
                  )}
                </p>
              </article>
            ))}
            {!orders.length && (
              <div className="rounded-[1.6rem] border border-mesh-900/10 bg-white shadow-[0_10px_40px_rgba(35,58,40,.06)] py-16 text-center">
                <Printer className="mx-auto text-ink/20" />
                <p className="mt-3 text-sm text-ink/45">
                  No print requests.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
