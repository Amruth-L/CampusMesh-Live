import ConditionPhotos from '../features/delivery/components/ConditionPhotos';
import DeliveryProgress from "../features/delivery/components/DeliveryProgress";
import {DirectPayments} from '../features/direct-upi/DirectPayments';
import ReturnDestination from '../features/delivery/components/ReturnDestination';
import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  House,
  Info,
  MapPin,
  Package,
  Phone,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { API_BASE_URL } from "../lib/api";
import QRCode from "qrcode";
import HandoverCredential from "../components/HandoverCredential";

const API_BASE = API_BASE_URL;
const money = (value) => "₹" + Number(value || 0).toFixed(2);
const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const statusLabel = (value) =>
  String(value || "").replaceAll("_", " ").toLowerCase();

const RENTAL_STATUS = {
  BOOKING_PAYMENT_PENDING: { label: "Payment pending", tone: "amber" },
  RENTAL_PAYMENT_COMPLETED: { label: "Awaiting owner", tone: "blue" },
  OWNER_PENDING: { label: "Awaiting owner", tone: "blue" },
  DEPOSIT_PENDING: { label: "Deposit required", tone: "amber" },
  MATCHING_COURIER: { label: "Finding a courier", tone: "blue" },
  QR_GENERATED: { label: "Ready for pickup", tone: "green" },
  COURIER_ASSIGNED: { label: "Courier assigned", tone: "blue" },
  RENTAL_ACTIVE: { label: "Rental active", tone: "green" },
  RETURN_LOCATION_PENDING: { label: "Waiting for return destination", tone: "amber" },
  RETURN_MATCHING: { label: "Return courier matching", tone: "blue" },
  RETURN_PENDING: { label: "Awaiting owner return inspection", tone: "amber" },
  COMPLETED: { label: "Completed & Refunded", tone: "green" },
  DEPOSIT_REFUNDED: { label: "Completed & Refunded", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

const DELIVERY_STATUS = {
  WAITING_FOR_DEPOSIT: { label: "Waiting for deposit", tone: "amber" },
  MATCHING_COURIER: { label: "Finding a courier", tone: "blue" },
  NO_COURIER_AVAILABLE: { label: "Waiting for route match", tone: "amber" },
  COURIER_ASSIGNED: { label: "Courier assigned", tone: "blue" },
  GOING_TO_PICKUP: { label: "Courier heading to pickup", tone: "blue" },
  ARRIVED_AT_PICKUP: { label: "At pickup", tone: "green" },
  IN_TRANSIT: { label: "In transit", tone: "blue" },
  ARRIVED_AT_DESTINATION: { label: "At destination", tone: "green" },
  RETURN_LOCATION_PENDING: { label: "Waiting for return destination", tone: "amber" },
  RETURN_MATCHING: { label: "Matching return courier", tone: "blue" },
  RETURN_COURIER_ASSIGNED: { label: "Return courier assigned", tone: "blue" },
  RETURN_IN_TRANSIT: { label: "Return item in transit", tone: "blue" },
  DELIVERY_PAYMENT_PENDING: { label: "Awaiting delivery payment", tone: "amber" },
  COMPLETED: { label: "Delivered", tone: "green" },
};

const toneClasses = {
  green: "border-mesh-200 bg-mesh-50 text-mesh-800",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

function ConnectionPill({ state }) {
  const copy =
    state === "live"
      ? "Live updates"
      : state === "reconnecting"
        ? "Reconnecting"
        : "Backend disconnected";
  const color =
    state === "live"
      ? "bg-mesh-500"
      : state === "reconnecting"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs font-bold text-ink/60">
      <i className={"size-2 rounded-full " + color} />
      {copy}
    </span>
  );
}

function CountdownTimer({ deadline }) {
  const [seconds, setSeconds] = useState(null);
  useEffect(() => {
    if (!deadline) return undefined;
    const calculate = () =>
      Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
    setSeconds(calculate());
    const timer = setInterval(() => setSeconds(calculate()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  if (seconds === null) return null;
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-mono text-sm font-black text-amber-800">
      <Clock3 size={15} /> {minutes}:{remainder}
    </span>
  );
}

export default function RentDetails() {
  const { rentalId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rental, setRental] = useState(null);
  const [payments, setPayments] = useState([]);
  const [extensions, setExtensions] = useState([]);
  const [pendingExtension, setPendingExtension] = useState(null);
  const [refund, setRefund] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [callStatus, setCallStatus] = useState(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState("reconnecting");
  const [error, setError] = useState("");
  const [feedbackMsg, setFeedbackMsg] = useState(null);
  const [payingDeposit, setPayingDeposit] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modals & Action States
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [extendingDays, setExtendingDays] = useState(2);
  const [extendingReason, setExtendingReason] = useState("");
  const [extendingLoading, setExtendingLoading] = useState(false);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnMode, setReturnMode] = useState("DIRECT");
  const [returnLoading, setReturnLoading] = useState(false);

  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [hasDamage, setHasDamage] = useState(false);
  const [damageAmount, setDamageAmount] = useState("");
  const [damageDesc, setDamageDesc] = useState("");
  const [inspectLoading, setInspectLoading] = useState(false);
  const [conditionConfirmed, setConditionConfirmed] = useState(false);

  const [reminderSending, setReminderSending] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("token");
    try {
      const read = async (path) => {
        const response = await fetch(API_BASE + path, {
          headers: { Authorization: "Bearer " + token },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not refresh this rental.");
        return data;
      };
      // A temporary failure in delivery or call tracking must not hide a paid rental.
      const [rentalResult, deliveryResult, callResult] = await Promise.allSettled([
        read("/api/rentals/" + rentalId + "/status"),
        read("/api/delivery/rental/" + rentalId),
        read("/api/calls/rentals/" + rentalId + "/status"),
      ]);
      if (rentalResult.status !== "fulfilled") throw rentalResult.reason;
      const rentalData = rentalResult.value;
      setRental(rentalData.rental);
      setPayments(rentalData.payments || []);
      setExtensions(rentalData.extensions || []);
      setPendingExtension(rentalData.pending_extension || null);
      setRefund(rentalData.refund || null);
      if (deliveryResult.status === "fulfilled") setDelivery(deliveryResult.value);
      setDeliveryError(deliveryResult.status === "fulfilled" ? "" : "Delivery tracking is temporarily unavailable. Your rental and payment are still recorded.");
      setCallStatus(callResult.status === "fulfilled" ? callResult.value : null);
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Could not refresh this rental.");
    } finally {
      setLoading(false);
    }
  }, [rentalId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const socket = io(API_BASE, {
      auth: { token: localStorage.getItem("token") },
      reconnectionAttempts: 5,
    });
    socket.on("connect", () => setConnection("live"));
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", () => setConnection("offline"));
    const refresh = () => load();
    [
      "rental:request",
      "rental:status",
      "rental:extension_requested",
      "rental:extension_responded",
      "rental:completed",
      "delivery:created",
      "delivery:assigned",
      "delivery:status",
      "delivery:location",
      "delivery:completed",
    ].forEach((event) => socket.on(event, refresh));

    socket.on("rental:reminder", (data) => {
      setFeedbackMsg({
        type: "info",
        text: data.message || "Return reminder received from the owner.",
      });
      setTimeout(() => setFeedbackMsg(null), 8000);
    });

    if (delivery?.delivery_id) socket.emit("delivery:join", delivery.delivery_id);
    return () => socket.close();
  }, [delivery?.delivery_id, load]);

  useEffect(() => {
    const fast =
      [
        "DEPOSIT_PENDING",
        "MATCHING_COURIER",
        "NO_COURIER_AVAILABLE",
        "COURIER_ASSIGNED",
        "GOING_TO_PICKUP",
        "ARRIVED_AT_PICKUP",
        "IN_TRANSIT",
        "ARRIVED_AT_DESTINATION",
      "DELIVERY_PAYMENT_PENDING",
        "RETURN_MATCHING",
        "RETURN_COURIER_ASSIGNED",
        "RETURN_IN_TRANSIT",
      ].includes(delivery?.status) ||
      [
        "OWNER_PENDING",
        "RENTAL_PAYMENT_COMPLETED",
        "DEPOSIT_PENDING",
        "MATCHING_COURIER",
        "RETURN_MATCHING",
      ].includes(rental?.status);
    const timer = setInterval(load, fast ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [delivery?.status, rental?.status, load]);

  const payDeposit = async () => {
    if(rental?.payment_method==='DIRECT_UPI'){document.querySelector('[aria-label="Direct UPI payments"]')?.scrollIntoView({behavior:'smooth'});return;}
    setPayingDeposit(true);
    setError("");
    const token = localStorage.getItem("token");
    try {
      const orderResponse = await fetch(
        API_BASE + "/api/payment/create-deposit-order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ rental_id: rentalId }),
        },
      );
      const order = await orderResponse.json();
      if (!orderResponse.ok)
        throw new Error(order.error || "Could not create deposit order.");
      if (order.already_paid) { await load(); return; }
      if (order.simulated) {
        const verifyResponse = await fetch(
          API_BASE + "/api/payment/verify-deposit",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + token,
            },
            body: JSON.stringify({
              rental_id: rentalId,
              gateway_order_id: order.order_id,
              gateway_payment_id: "sim_dep_" + Date.now(),
              gateway_signature: "sim_sig",
            }),
          },
        );
        const verified = await verifyResponse.json();
        if (!verifyResponse.ok)
          throw new Error(verified.error || "Deposit verification failed.");
        await load();
      } else {
        const options = {
          key: order.razorpay_key,
          amount: Math.round(Number(rental.deposit_amount) * 100),
          currency: "INR",
          name: "CampusMesh security deposit",
          description: "Deposit for " + rental.listing_title,
          order_id: order.order_id,
          handler: async (response) => {
            const verifyResponse = await fetch(
              API_BASE + "/api/payment/verify-deposit",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer " + token,
                },
                body: JSON.stringify({
                  rental_id: rentalId,
                  gateway_order_id: response.razorpay_order_id,
                  gateway_payment_id: response.razorpay_payment_id,
                  gateway_signature: response.razorpay_signature,
                }),
              },
            );
            if (!verifyResponse.ok)
              setError("Deposit verification failed. Please try again.");
            await load();
          },
          prefill: { name: user?.name, email: user?.email },
          theme: { color: "#2b7044" },
        };
        new window.Razorpay(options).open();
      }
    } catch (payError) {
      setError(payError.message || "Could not complete deposit payment.");
    } finally {
      setPayingDeposit(false);
    }
  };

  // Borrower: Request Rental Extension
  const handleRequestExtension = async (e) => {
    e.preventDefault();
    setExtendingLoading(true);
    setError("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        API_BASE + "/api/rentals/" + rentalId + "/extend-request",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            additional_days: extendingDays,
            reason: extendingReason,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request extension.");
      setShowExtendModal(false);
      setExtendingReason("");
      setFeedbackMsg({
        type: "success",
        text: `Extension request for +${extendingDays} day(s) submitted to owner.`,
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setExtendingLoading(false);
    }
  };

  // Owner: Respond to Extension
  const handleRespondExtension = async (decision) => {
    if (!pendingExtension) return;
    setError("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        API_BASE + "/api/rentals/" + rentalId + "/extend-respond",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            extension_id: pendingExtension.id,
            decision,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to respond to extension.");
      setFeedbackMsg({
        type: "success",
        text:
          decision === "ACCEPTED"
            ? "Extension accepted! Rental period updated."
            : "Extension request declined.",
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  // Owner: Send Return Reminder
  const handleSendReminder = async () => {
    setReminderSending(true);
    setError("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        API_BASE + "/api/rentals/" + rentalId + "/send-reminder",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reminder.");
      setFeedbackMsg({
        type: "success",
        text: "Return reminder sent to the renter.",
      });
      setTimeout(() => setFeedbackMsg(null), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setReminderSending(false);
    }
  };

  // Borrower: Initiate Return
  const handleInitiateReturn = async (e) => {
    e.preventDefault();
    setReturnLoading(true);
    setError("");
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(
        API_BASE + "/api/rentals/" + rentalId + "/return-request",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({ mode: returnMode }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to initiate return.");
      setShowReturnModal(false);
      setFeedbackMsg({
        type: "success",
        text:
          returnMode === "DIRECT"
            ? "Direct return initiated! Hand over the item to the owner."
            : "Return requested. The owner will confirm the destination before couriers are notified.",
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setReturnLoading(false);
    }
  };

  // Owner: Confirm Return & Refund Deposit
  const handleConfirmReturn = async (e) => {
    e.preventDefault();
    setInspectLoading(true);
    setError("");
    const token = localStorage.getItem("token");
    try {
      const dmg = hasDamage ? parseFloat(damageAmount) || 0 : 0;
      const res = await fetch(
        API_BASE + "/api/rentals/" + rentalId + "/complete",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            condition_confirmed: conditionConfirmed,
            damage_amount: dmg,
            damage_description: hasDamage ? damageDesc : null,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm return.");
      setShowInspectionModal(false);
      setConditionConfirmed(false);
      setFeedbackMsg({
        type: "success",
        text: data.message || "Return confirmed. Check refund status below.",
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setInspectLoading(false);
    }
  };

  useEffect(() => {
    if (
      !rental ||
      rental.delivery_requested ||
      rental.status !== "QR_GENERATED" ||
      !rental.qr_code_hash
    )
      return;
    const target = document.getElementById("self-pickup-qr");
    if (target)
      QRCode.toCanvas(
        target,
        "campusmesh:rental:" + rental.id + ":" + rental.qr_code_hash,
        { width: 180, color: { dark: "#ffffff", light: "#163225" } },
      ).catch(() => {});
  }, [rental]);

  const isBorrower = rental?.borrower_id === user?.id;
  const isOwner = rental?.owner_id === user?.id;
  const isDelivery = Boolean(
    rental?.delivery_requested || Number(rental?.delivery_fee) > 0 || delivery?.task_type === 'RENTAL_RETURN',
  );
  const rentalConfig = RENTAL_STATUS[rental?.status] || {
    label: statusLabel(rental?.status),
    tone: "blue",
  };
  const deliveryConfig = DELIVERY_STATUS[delivery?.status];
  const displayConfig = rental?.return_workflow?.can_inspect
    ? { label: 'Owner inspection required', tone: 'amber' }
    : rental?.return_workflow?.inspected && rental?.deposit_status === 'REFUNDED' && !rental.return_workflow.delivery_settled
      ? { label: 'Return courier fee pending', tone: 'amber' }
      : rental?.payment_method === 'DIRECT_UPI' && rental?.deposit_status === 'REFUND_PENDING'
    ? { label: 'Awaiting deposit refund receipt', tone: 'amber' }
    : rental?.status?.startsWith('RETURN_') && delivery?.status === 'COMPLETED'
      ? rentalConfig
      : isDelivery && deliveryConfig && delivery?.status !== "WAITING_FOR_DEPOSIT"
      ? deliveryConfig
      : rentalConfig;

  const isCompleted = ["COMPLETED", "DEPOSIT_REFUNDED"].includes(rental?.status);
  const isOverdue = Boolean(rental?.is_overdue);

  // Daily rate for extension preview
  const dailyRate = useMemo(() => {
    if (!rental) return 0;
    const days = Number(rental.rental_days) || 1;
    return Number(rental.rental_fee) / days;
  }, [rental]);
  const estimatedExtensionFee = (dailyRate * Number(extendingDays)).toFixed(2);

  const blockedCopy = useMemo(() => {
    if (!rental) return null;
    if (rental.payment_method==='DIRECT_UPI' && ['OWNER_PENDING','BOOKING_PAYMENT_PENDING','DEPOSIT_PENDING'].includes(rental.status)) return null;
    if (rental.payment_method === 'DIRECT_UPI' && rental.return_workflow?.can_inspect) {
      return {
        title: 'Item returned · Owner inspection required',
        body: isOwner ? 'Check the returned item against the pickup and return photos below. Approve its condition to release the deposit refund. Courier fee confirmation is a separate step.' : 'Your return handover is recorded. The owner must check the item condition before sending your deposit refund.',
        action: isOwner ? 'Inspect item & approve refund' : null,
        actionFn: () => { setConditionConfirmed(false); setShowInspectionModal(true); },
        tone: 'amber',
      };
    }
    if (rental.payment_method === 'DIRECT_UPI' && rental.return_workflow?.inspected && rental.status !== 'COMPLETED') {
      return {
        title: rental.deposit_status === 'REFUNDED' ? 'Refund received · Return courier fee pending' : 'Item condition approved · Deposit refund pending',
        body: rental.deposit_status === 'REFUNDED' ? 'The renter confirmed the refund. Settle the return courier fee and have the courier confirm receipt to close this rental.' : rental.return_workflow.refund_account_ready ? 'The owner sends the refund using the request in Direct UPI payments. The renter must check their bank and confirm receipt.' : 'The renter needs to save their receiving UPI details in the form on this page. The refund request will appear automatically.',
        action: null, tone: 'amber',
      };
    }
    if (rental.is_demo) {
      return {
        title: "Sample listing booking",
        body: "This catalogue example has no live lender to fulfil the request. Use an item published by a student to test owner approval, delivery and automated calls.",
        action: null,
        tone: "amber",
      };
    }
    if (["BOOKING_PAYMENT_PENDING", "BOOKING_REQUESTED"].includes(rental.status)) {
      return {
        title: "Booking payment is not confirmed yet",
        body: isBorrower
          ? "Already completed checkout? Check the existing payment before trying again. The owner can accept after payment is verified."
          : "This checkout has not become a submitted request yet. Accept and Reject appear after the renter’s payment is verified.",
        action: isBorrower ? "Check booking payment" : null,
        actionFn: () => navigate(`/rental-payment/${rentalId}`),
        tone: "amber",
      };
    }
    if (
      ["OWNER_PENDING", "RENTAL_PAYMENT_COMPLETED"].includes(rental.status)
    ) {
      return {
        title: "Waiting for the listing owner",
        body: "Your booking payment is complete. Courier matching starts after the owner accepts and you pay the security deposit.",
        action: null,
        tone: "blue",
      };
    }
    if (rental.status === "DEPOSIT_PENDING") {
      return {
        title: "Deposit required to release delivery",
        body: "The owner accepted your rental. Pay the refundable deposit before an online courier can accept this request.",
        action: isBorrower ? "Pay security deposit" : null,
        tone: "amber",
      };
    }
    if (delivery?.status === "WAITING_FOR_DEPOSIT") {
      return {
        title: "Delivery is queued",
        body: "The delivery request is saved with the real owner, renter, item, pickup, and destination. It will be offered after deposit payment.",
        action: null,
        tone: "amber",
      };
    }
    if (delivery?.status === "NO_COURIER_AVAILABLE") {
      return {
        title: "Waiting for a matching courier",
        body: "No courier has accepted yet. The request will be offered to available students automatically.",
        action: null,
        tone: "amber",
      };
    }
    if (delivery?.status === "MATCHING_COURIER") {
      return {
        title: "Searching for an online courier",
        body: "Online couriers can review the pickup and destination and accept the request. This page will update automatically.",
        action: null,
        tone: "blue",
      };
    }
    if (delivery?.status === "COURIER_ASSIGNED") {
      return {
        title: "Courier accepted the request",
        body:
          (delivery.courier_name || "Your courier") +
          " will collect the item from " +
          delivery.pickup_location +
          ".",
        action: null,
        tone: "green",
      };
    }
    if (delivery?.status === "IN_TRANSIT") {
      return {
        title: "Your item is on the way",
        body:
          "The pickup QR was verified. Watch the courier’s progress until they reach " +
          delivery.drop_location +
          ".",
        action: null,
        tone: "blue",
      };
    }
    if (delivery?.status === "ARRIVED_AT_DESTINATION") {
      return {
        title: "Confirm delivery",
        body: "The courier has arrived. Show the delivery QR or OTP to complete the handover.",
        action: null,
        tone: "green",
      };
    }
    if (delivery?.status === "DELIVERY_PAYMENT_PENDING") {
      return {
        title: "Handover verified · Delivery payment pending",
        body: "The borrower must pay the delivery fee and report the transaction. Delivery becomes complete only when the courier checks their bank and confirms receipt.",
        action: null,
        tone: "amber",
      };
    }
    if (rental.payment_method === 'DIRECT_UPI' && rental.deposit_status === 'REFUND_PENDING') {
      return {
        title: 'Item received · Deposit refund pending',
        body: isOwner
          ? 'You approved the return. Send the full deposit refund using the payment request above, then report its transaction reference. The renter must confirm receipt to close this rental.'
          : 'The owner approved your return. Check the refund below and confirm receipt only after the money reaches your bank. Your rental stays open until then.',
        action: null,
        tone: 'amber',
      };
    }
    if (rental?.status === "RETURN_PENDING") {
      return {
        title: "Returned item awaiting owner inspection",
        body: "The owner must receive and inspect the item before approving the security deposit refund. The rental closes after the renter confirms refund receipt.",
        action: isOwner ? "Inspect & Confirm Return" : null,
        actionFn: () => setShowInspectionModal(true),
        tone: "amber",
      };
    }
    if (delivery?.status === "RETURN_LOCATION_PENDING") {
      return { title: "Owner confirmation needed", body: "The owner can confirm or change the return destination above before couriers receive this request.", action: null, tone: "amber" };
    }
    if (rental?.status === "RETURN_MATCHING") {
      return {
        title: "Return courier matching in progress",
        body: "Campus courier matching has started for returning the item back to the owner.",
        action: null,
        tone: "blue",
      };
    }
    if (isCompleted) {
      return {
        title: "Rental completed · Check deposit status",
        body: "The item has been returned. Check the refund status below for deposit settlement.",
        action: null,
        tone: "green",
      };
    }
    if (delivery?.status === "COMPLETED") {
      return {
        title: "Delivery completed",
        body: "The item handover is complete and your rental is active.",
        action: null,
        tone: "green",
      };
    }
    return null;
  }, [delivery, isBorrower, isOwner, isCompleted, rental, navigate, rentalId]);

  const copyId = async () => {
    await navigator.clipboard?.writeText(rentalId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (loading)
    return (
      <div className="grid min-h-[70vh] place-items-center bg-paper text-sm text-ink/50">
        Loading rental workspace…
      </div>
    );
  if (!rental)
    return (
      <div className="mx-auto grid min-h-[70vh] max-w-xl place-items-center bg-paper px-6 text-center">
        <div>
          <p className="text-4xl">⚠️</p>
          <h1 className="mt-3 font-display text-3xl">Rental unavailable</h1>
          <p className="mt-2 text-sm text-ink/70">
            {error || "Refresh or return to your rentals."}
          </p>
          <p className="mt-3 text-sm text-ink/70">If you already paid, do not pay again. Retry loading your booking.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button onClick={() => { setLoading(true); load(); }} className="rounded-xl bg-mesh-700 px-5 py-3 text-sm font-bold text-white">Retry</button>
            <Link to="/my-rentals" className="rounded-xl border border-ink/20 bg-white px-5 py-3 text-sm font-bold text-ink">My rentals</Link>
          </div>
        </div>
      </div>
    );

  return (
    <main className="min-h-screen bg-paper pb-16 text-ink">
      <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:px-7 lg:px-10">
        {/* Navigation & Status Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-bold text-ink/65 transition hover:-translate-x-0.5 hover:border-mesh-300"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <ConnectionPill state={connection} />
            <span
              className={
                "rounded-full border px-3 py-1.5 text-xs font-extrabold " +
                toneClasses[displayConfig.tone]
              }
            >
              {displayConfig.label}
            </span>
          </div>
        </div>

        {rental.return_workflow?.requested && blockedCopy && <section className="rounded-xl border border-ink/15 bg-white p-5" aria-label="Next return action">
          <h2 className="text-lg font-bold">{blockedCopy.title}</h2>
          <p className="mt-2 text-sm leading-6 text-ink/75">{blockedCopy.body}</p>
          {blockedCopy.action && <button className="brand-button mt-4" onClick={blockedCopy.actionFn}>{blockedCopy.action}</button>}
        </section>}
        {rental.payment_method==='DIRECT_UPI' && <DirectPayments rental={rental} onChange={load}/>}
        {/* Listing Header Card */}
        <section className="flex flex-col justify-between gap-5 rounded-[1.7rem] border border-mesh-900/10 bg-[radial-gradient(circle_at_100%_0%,rgba(76,145,82,.18),transparent_35%),white] p-6 shadow-[0_15px_50px_rgba(35,58,40,.07)] md:flex-row md:items-end">
          <div className="flex items-start gap-4">
            {rental.listing_image ? (
              <img
                src={rental.listing_image}
                alt=""
                className="size-20 shrink-0 rounded-2xl object-cover"
              />
            ) : (
              <span className="grid size-20 shrink-0 place-items-center rounded-2xl bg-mesh-50 text-mesh-700">
                <Package />
              </span>
            )}
            <div>
              <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">
                {rental.listing_category || "Rental"}
              </span>
              <h1 className="mt-2 max-w-[38rem] font-display text-4xl font-semibold leading-tight sm:text-5xl">
                {rental.listing_title}
              </h1>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink/50">
                <House size={14} /> {rental.listing_location || "Campus pickup"}
              </p>
            </div>
          </div>
          <button
            onClick={copyId}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-bold text-ink/50 md:self-end"
          >
            <Copy size={14} /> {copied ? "Copied booking ID" : "Copy booking ID"}
          </button>
        </section>

        {isDelivery && <DeliveryProgress rental={rental} delivery={delivery} error={deliveryError} />}

        {isBorrower && (
          <section className="rounded-2xl border border-ink/15 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-bold text-ink"><Phone size={18} className="text-mesh-700" /> {callStatus?.title || "Booking call status"}</h2>
              <Link to="/reminders" className="text-sm font-bold text-mesh-700 underline underline-offset-4">Manage calls</Link>
            </div>
            {callStatus ? (
              <>
                {callStatus.latestCall && <p className="mt-2 text-sm font-semibold text-ink/80">Last attempt: {statusLabel(callStatus.latestCall.status)}{callStatus.latestCall.outcome ? ` · ${callStatus.latestCall.outcome}` : ""}</p>}
                {callStatus.reasons?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-ink/80">{callStatus.reasons.map(reason => <li key={reason.code}>{reason.message}</li>)}</ul>}
                <p className="mt-3 text-xs font-semibold text-ink/65">Calling hours: {callStatus.callWindow}</p>
              </>
            ) : <p className="mt-2 text-sm text-ink/70">Call status could not be loaded. Check Reminders for your phone verification and call preferences.</p>}
          </section>
        )}

        {deliveryError && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{deliveryError}</p>}

        {feedbackMsg && (
          <div
            className={`flex items-start justify-between gap-3 rounded-2xl border p-4 text-sm font-semibold shadow-sm ${
              feedbackMsg.type === "success"
                ? "border-mesh-300 bg-mesh-50 text-mesh-900"
                : "border-sky-300 bg-sky-50 text-sky-900"
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="shrink-0 text-mesh-600" />
              <span>{feedbackMsg.text}</span>
            </div>
            <button
              onClick={() => setFeedbackMsg(null)}
              className="text-ink/40 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            <Info size={17} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {/* OVERDUE ALERT BANNER */}
        {isOverdue && !isCompleted && (
          <section className="rounded-[1.5rem] border border-amber-300 bg-amber-500/10 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-amber-500 text-white shadow-sm">
                  <AlertTriangle size={22} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-amber-950">
                      Rental Overdue by {rental.overdue_days || 1} day(s)
                    </h2>
                    <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-white">
                      Action Required
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-amber-900/80">
                    The scheduled return date was <b>{dateLabel(rental.end_date)}</b>.
                    {isOwner
                      ? " You can nudge the renter with a reminder or inspect the item once received to release the deposit."
                      : " Please return the item to the owner or request an extension to prevent deposit penalties."}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isOwner && (
                  <>
                    <button
                      onClick={handleSendReminder}
                      disabled={reminderSending}
                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-extrabold text-amber-900 shadow-sm transition hover:bg-amber-50 disabled:opacity-50"
                    >
                      <Send size={14} />
                      {reminderSending ? "Sending…" : "Send return reminder"}
                    </button>
                    <button
                      onClick={() => setShowInspectionModal(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-mesh-600 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700"
                    >
                      <CheckCircle2 size={14} /> Inspect & complete return
                    </button>
                  </>
                )}
                {isBorrower && (
                  <>
                    <button
                      disabled={rental.payment_method==='DIRECT_UPI'} title={rental.payment_method==='DIRECT_UPI'?'Contact support for direct-UPI rental extensions':undefined} onClick={() => setShowExtendModal(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-800"
                    >
                      <Calendar size={14} /> Request extension
                    </button>
                    <button
                      onClick={() => setShowReturnModal(true)}
                      className="inline-flex items-center gap-2 rounded-xl bg-mesh-600 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700"
                    >
                      <RotateCcw size={14} /> Initiate return
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* PENDING EXTENSION BANNER */}
        {pendingExtension && (
          <section className="rounded-[1.5rem] border border-sky-300 bg-sky-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sky-600 text-white shadow-sm">
                  <Calendar size={22} />
                </span>
                <div>
                  <h3 className="text-base font-black text-sky-950">
                    {isOwner
                      ? `${rental.borrower_name} requested a ${pendingExtension.additional_days}-day extension`
                      : `You requested a ${pendingExtension.additional_days}-day extension`}
                  </h3>
                  <p className="mt-1 text-sm text-sky-900/80">
                    New proposed return date: <b>{dateLabel(pendingExtension.new_end_date)}</b> · Additional fee: <b>{money(pendingExtension.additional_fee)}</b>
                    {pendingExtension.reason ? ` · "${pendingExtension.reason}"` : ""}
                  </p>
                  <p className="mt-1 text-xs text-sky-700">
                    {isOwner
                      ? "Accepting will update the booking end date and duration."
                      : "Awaiting approval from " + rental.owner_name + "."}
                  </p>
                </div>
              </div>
              {isOwner && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRespondExtension("ACCEPTED")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-mesh-600 px-4 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700"
                  >
                    <Check size={14} /> Accept extension
                  </button>
                  <button
                    onClick={() => handleRespondExtension("REJECTED")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-extrabold text-red-700 transition hover:bg-red-50"
                  >
                    <X size={14} /> Decline
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* COMPLETED / DEPOSIT REFUND SUMMARY CARD */}
        {rental.payment_method!=="DIRECT_UPI" && (isCompleted || rental.status === "CANCELLED") && (
          <section className="rounded-[1.5rem] border border-mesh-300 bg-mesh-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-mesh-600 text-white shadow-sm">
                  <CheckCircle2 size={24} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[.68rem] font-extrabold uppercase tracking-[.14em] text-mesh-700">
                      {isCompleted ? "Return confirmed" : "Booking cancelled"}
                    </span>
                    <span className="rounded-full bg-mesh-200/70 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-mesh-900">
                      {refund?.refund_status || "AWAITING OWNER REVIEW"}
                    </span>
                  </div>
                  <h2 className="mt-1 text-xl font-black text-mesh-950">
                    {isCompleted ? "Rental completed · Deposit status" : "Cancelled booking · Refund status"}
                  </h2>
                  <p className="mt-1 text-sm text-mesh-900/80">
                    Refund status reflects the payment provider’s confirmation. Contact support if a refund remains pending.
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-mesh-200 bg-white p-4 text-right">
                <span className="block text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                  Refund to Renter
                </span>
                {!['PROCESSED', 'NO_REFUND'].includes(refund?.refund_status) && (
                  <button className="my-2 block text-sm font-bold underline" onClick={async () => {
                    try {
                      const response = await fetch(API_BASE + '/api/payment/reconcile-refund', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
                        body: JSON.stringify({ rental_id: rentalId }),
                      });
                      const data = await response.json();
                      if (!response.ok) throw new Error(data.error || 'Could not refresh refund.');
                      await load();
                    } catch (err) { setError(err.message); }
                  }}>Refresh refund status</button>
                )}
                <strong className="mt-1 block text-2xl font-black text-mesh-700">
                  {money(refund?.refund_amount ?? (isCompleted ? rental.deposit_amount : rental.booking_amount))}
                </strong>
                {Number(refund?.damage_amount || 0) > 0 && (
                  <span className="block text-xs font-semibold text-amber-700">
                    (₹{Number(refund.damage_amount).toFixed(2)} deducted for damage)
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* MAIN BODY GRID */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {delivery?.task_type === 'RENTAL_RETURN' && <ReturnDestination rentalId={rentalId} delivery={delivery} isOwner={isOwner} onSaved={load}/>}
            {rental.return_workflow?.can_inspect && isOwner && rental.return_delivery_id && <div className="space-y-4">
              {rental.outbound_delivery_id && <ConditionPhotos deliveryId={rental.outbound_delivery_id} title="Original item condition" />}
              <ConditionPhotos deliveryId={rental.return_delivery_id} title="Returned item condition" />
            </div>}
            {blockedCopy && !rental.return_workflow?.requested && (
              <section
                className={
                  "rounded-[1.5rem] border p-5 shadow-sm " +
                  toneClasses[blockedCopy.tone]
                }
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/80">
                    {blockedCopy.tone === "amber" ? (
                      <ShieldCheck size={19} />
                    ) : blockedCopy.tone === "green" ? (
                      <Check size={19} />
                    ) : (
                      <Radio size={19} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-extrabold">{blockedCopy.title}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 opacity-75">
                      {blockedCopy.body}
                    </p>
                    {rental.deposit_deadline &&
                      rental.status === "DEPOSIT_PENDING" && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <CountdownTimer deadline={rental.deposit_deadline} />
                          <span className="text-xs font-semibold opacity-70">
                            Refundable deposit: {money(rental.deposit_amount)}
                          </span>
                        </div>
                      )}
                    {blockedCopy.action && (
                      <button
                        onClick={blockedCopy.actionFn || payDeposit}
                        disabled={payingDeposit}
                        className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-mesh-600 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-mesh-700 disabled:opacity-50"
                      >
                        <CreditCard size={16} />{" "}
                        {payingDeposit
                          ? "Opening payment…"
                          : blockedCopy.action}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* ACTIVE RENTAL QUICK CONTROLS BAR */}
            {!isCompleted &&
              ["RENTAL_ACTIVE", "RETURN_PENDING", "RETURN_MATCHING"].includes(
                rental.status,
              ) && (
                <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5 shadow-[0_10px_35px_rgba(35,58,40,.05)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">
                        Rental Controls
                      </span>
                      <h3 className="mt-1 text-lg font-extrabold">
                        Manage Item & Return
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isBorrower && !isCompleted && (
                        <>
                          <button
                            disabled={rental.payment_method==='DIRECT_UPI'} title={rental.payment_method==='DIRECT_UPI'?'Contact support for direct-UPI rental extensions':undefined} onClick={() => setShowExtendModal(true)}
                            className="inline-flex items-center gap-2 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-xs font-extrabold text-ink transition hover:border-mesh-400 hover:bg-mesh-50"
                          >
                            <Calendar size={15} /> Extend rental
                          </button>
                          <button
                            onClick={() => setShowReturnModal(true)}
                            className="inline-flex items-center gap-2 rounded-xl bg-mesh-600 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-mesh-700"
                          >
                            <RotateCcw size={15} /> Return item
                          </button>
                        </>
                      )}
                      {isOwner && !isCompleted && (
                        <>
                          <button
                            onClick={handleSendReminder}
                            disabled={reminderSending}
                            className="inline-flex items-center gap-2 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-xs font-extrabold text-ink transition hover:border-mesh-400 hover:bg-mesh-50 disabled:opacity-50"
                          >
                            <Send size={15} />
                            {reminderSending ? "Sending…" : "Send reminder"}
                          </button>
                          <button
                            onClick={() => setShowInspectionModal(true)}
                            className="inline-flex items-center gap-2 rounded-xl bg-mesh-600 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-mesh-700"
                          >
                            <CheckCircle2 size={15} /> Inspect & complete return
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </section>
              )}

            {/* DELIVERY HANDOFF STATUS CARD */}
            {isDelivery && delivery?.has_delivery && (
              <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5 shadow-[0_10px_35px_rgba(35,58,40,.05)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em] text-mesh-600">
                      {delivery.task_type === "RENTAL_RETURN"
                        ? "Return Delivery Handoff"
                        : "Delivery handoff"}
                    </span>
                    <h2 className="mt-1 text-xl font-extrabold">
                      {delivery.task_type === "RENTAL_RETURN"
                        ? "Item returning to owner"
                        : "A real person is moving this item"}
                    </h2>
                  </div>
                  <span
                    className={
                      "rounded-full border px-3 py-1.5 text-xs font-extrabold " +
                      toneClasses[
                        (DELIVERY_STATUS[delivery.status] || { tone: "blue" })
                          .tone
                      ]
                    }
                  >
                    {
                      (
                        DELIVERY_STATUS[delivery.status] || {
                          label: statusLabel(delivery.status),
                        }
                      ).label
                    }
                  </span>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-paper p-4">
                    <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                      Pickup
                    </span>
                    <p className="mt-2 flex items-start gap-2 text-sm font-bold">
                      <MapPin size={16} className="mt-0.5 shrink-0 text-mesh-600" />
                      {delivery.pickup_location}
                    </p>
                    <span className="mt-1 block text-xs text-ink/45">
                      {delivery.task_type === "RENTAL_RETURN" ? "Renter: " + (delivery.renter_name || "Renter") : "Owner: " + (delivery.owner_name || "Listing owner")}
                    </span>
                  </div>
                  <div className="rounded-2xl bg-paper p-4">
                    <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                      Drop-off
                    </span>
                    <p className="mt-2 flex items-start gap-2 text-sm font-bold">
                      <MapPin size={16} className="mt-0.5 shrink-0 text-mesh-600" />
                      {delivery.drop_location}
                    </p>
                    <span className="mt-1 block text-xs text-ink/45">
                      {delivery.task_type === "RENTAL_RETURN" ? "Owner: " + (delivery.owner_name || "Owner") : "Renter: " + (delivery.renter_name || "Renter")}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {delivery.courier ? (
                    <div className="rounded-2xl border border-mesh-200 bg-mesh-50 p-4">
                      <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-mesh-700">
                        Accepted courier
                      </span>
                      <p className="mt-2 flex items-center gap-2 text-sm font-extrabold">
                        <UserRound size={16} /> {delivery.courier.name}
                      </p>
                      <p className="mt-1 text-xs text-mesh-800/70">
                        {delivery.courier.phone ||
                          "Contact available in the delivery workspace"}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/15 p-4">
                      <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                        Courier
                      </span>
                      <p className="mt-2 text-sm font-bold">
                        {delivery.next_action ||
                          "Waiting for a courier to accept."}
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-ink/10 p-4">
                    <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                      Next action
                    </span>
                    <p className="mt-2 text-sm font-bold">
                      {delivery.next_action || "No action needed right now."}
                    </p>
                  </div>
                </div>
                {delivery.delivery_id && delivery.courier && (
                  <Link
                    to={"/delivery/" + delivery.delivery_id + "/track"}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white transition hover:bg-mesh-800"
                  >
                    <Truck size={15} /> Open live tracking
                  </Link>
                )}
              </section>
            )}

            {/* OUTBOUND HANDOVER CREDENTIALS */}
            {isDelivery &&
              delivery?.has_delivery &&
              delivery.task_type !== "RENTAL_RETURN" &&
              isOwner &&
              delivery.status === "ARRIVED_AT_PICKUP" && (
                <HandoverCredential
                  deliveryId={delivery.delivery_id}
                  stage="PICKUP"
                  title="Show pickup QR to the courier"
                />
              )}
            {isDelivery &&
              delivery?.has_delivery &&
              delivery.task_type !== "RENTAL_RETURN" &&
              isBorrower &&
              delivery.status === "ARRIVED_AT_DESTINATION" && (
                <HandoverCredential
                  deliveryId={delivery.delivery_id}
                  stage="DELIVERY"
                  title="Show delivery QR to the courier"
                />
              )}

            {/* RETURN DELIVERY HANDOVER CREDENTIALS */}
            {isDelivery &&
              delivery?.has_delivery &&
              delivery.task_type === "RENTAL_RETURN" &&
              isBorrower &&
              delivery.status === "ARRIVED_AT_PICKUP" && (
                <HandoverCredential
                  deliveryId={delivery.delivery_id}
                  stage="RETURN_PICKUP"
                  title="Show return pickup QR to the courier"
                />
              )}
            {isDelivery &&
              delivery?.has_delivery &&
              delivery.task_type === "RENTAL_RETURN" &&
              isOwner &&
              (delivery.status === "ARRIVED_AT_DESTINATION" ||
                delivery.status === "RETURN_IN_TRANSIT") && (
                <HandoverCredential
                  deliveryId={delivery.delivery_id}
                  stage="RETURN_RECEIVED"
                  title="Show return receipt QR to the courier"
                />
              )}

            {!isDelivery && rental.status === "QR_GENERATED" && (
              <section className="rounded-[1.5rem] border border-mesh-200 bg-ink p-5 text-white">
                <div className="flex items-center gap-2 text-mesh-200">
                  <ShieldCheck size={18} />
                  <span className="text-[.68rem] font-extrabold uppercase tracking-[.16em]">
                    Self-pickup verification
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-extrabold">
                  Show this QR at the rental counter
                </h2>
                <canvas
                  id="self-pickup-qr"
                  className="mx-auto mt-5 rounded-2xl bg-white p-3"
                />
                <p className="mt-3 text-center text-xs text-white/55">
                  This legacy QR is used only for self-pickup rentals.
                </p>
              </section>
            )}

            {/* RENTAL DETAILS CARDS */}
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-ink/10 bg-white p-4">
                <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                  Rental period
                </span>
                <p className="mt-2 text-sm font-extrabold">
                  {dateLabel(rental.start_date)} → {dateLabel(rental.end_date)}
                </p>
                {isOverdue && !isCompleted && (
                  <span className="mt-1 block text-[11px] font-bold text-amber-600">
                    Past due date
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-ink/10 bg-white p-4">
                <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                  Duration
                </span>
                <p className="mt-2 text-sm font-extrabold">
                  {rental.rental_days} day{Number(rental.rental_days) === 1 ? "" : "s"}
                </p>
                {extensions.filter((x) => x.status === "ACCEPTED").length > 0 && (
                  <span className="mt-1 block text-[11px] font-semibold text-mesh-700">
                    (Extended by +
                    {extensions
                      .filter((x) => x.status === "ACCEPTED")
                      .reduce((acc, curr) => acc + curr.additional_days, 0)}{" "}
                    days)
                  </span>
                )}
              </div>
              <div className="rounded-2xl border border-ink/10 bg-white p-4">
                <span className="text-[.65rem] font-extrabold uppercase tracking-[.14em] text-ink/40">
                  People
                </span>
                <p className="mt-2 text-sm font-extrabold">
                  {rental.owner_name} · {rental.borrower_name}
                </p>
              </div>
            </section>

            {/* EXTENSIONS HISTORY */}
            {extensions.length > 0 && (
              <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5 shadow-[0_10px_35px_rgba(35,58,40,.05)]">
                <div className="flex items-center gap-2">
                  <Calendar size={17} className="text-mesh-600" />
                  <h3 className="text-base font-extrabold">
                    Extension History
                  </h3>
                </div>
                <div className="mt-3 space-y-2">
                  {extensions.map((ext) => (
                    <div
                      key={ext.id}
                      className="flex items-center justify-between rounded-xl border border-ink/5 bg-paper p-3 text-xs"
                    >
                      <div>
                        <span className="font-extrabold">
                          +{ext.additional_days} day(s) until {dateLabel(ext.new_end_date)}
                        </span>
                        {ext.reason && (
                          <p className="mt-0.5 text-ink/50 italic">"{ext.reason}"</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold">{money(ext.additional_fee)}</span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase ${
                            ext.status === "ACCEPTED"
                              ? "bg-mesh-100 text-mesh-800"
                              : ext.status === "REJECTED"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {ext.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ASIDE PANEL */}
          <aside className="space-y-5 lg:sticky lg:top-5">
            <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5 shadow-[0_10px_35px_rgba(35,58,40,.05)]">
              <div className="flex items-center gap-2">
                <CreditCard size={17} className="text-mesh-600" />
                <h2 className="text-base font-extrabold">Payment summary</h2>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between text-ink/55">
                  <span>Rental fee</span>
                  <b className="text-ink">{money(rental.rental_fee)}</b>
                </div>
                <div className="flex justify-between text-ink/55">
                  <span>Delivery fee</span>
                  <b className="text-ink">{money(rental.delivery_fee)}</b>
                </div>
                <div className="flex justify-between text-ink/55">
                  <span>Platform fee</span>
                  <b className="text-ink">{money(rental.platform_fee)}</b>
                </div>
                <div className="border-t border-ink/10 pt-3">
                  <div className="flex justify-between font-extrabold">
                    <span>Booking amount</span>
                    <span>{money(rental.booking_amount)}</span>
                  </div>
                  <div className="mt-3 flex justify-between text-ink/55">
                    <span>Security deposit</span>
                    <b
                      className={
                        rental.deposit_status === "HELD" ||
                        rental.deposit_status === "PAID"
                          ? "text-mesh-700"
                          : rental.deposit_status === "REFUNDED"
                            ? "text-mesh-600"
                            : "text-ink"
                      }
                    >
                      {rental.deposit_status === "REFUNDED"
                        ? "Refunded"
                        : rental.deposit_status === "HELD" ||
                            rental.deposit_status === "PAID"
                          ? "Held safely"
                          : money(rental.deposit_amount)}
                    </b>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5">
              <div className="flex items-center gap-2">
                <UserRound size={17} className="text-mesh-600" />
                <h2 className="text-base font-extrabold">
                  People on this rental
                </h2>
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-paper p-3">
                  <div>
                    <span className="block text-[.65rem] font-extrabold uppercase tracking-[.12em] text-ink/40">
                      Owner
                    </span>
                    <b className="mt-1 block text-sm">{rental.owner_name}</b>
                  </div>
                  {isOwner && (
                    <span className="rounded-full bg-mesh-100 px-2 py-1 text-[10px] font-bold text-mesh-800">
                      You
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-paper p-3">
                  <div>
                    <span className="block text-[.65rem] font-extrabold uppercase tracking-[.12em] text-ink/40">
                      Renter
                    </span>
                    <b className="mt-1 block text-sm">{rental.borrower_name}</b>
                  </div>
                  {isBorrower && (
                    <span className="rounded-full bg-mesh-100 px-2 py-1 text-[10px] font-bold text-mesh-800">
                      You
                    </span>
                  )}
                </div>
              </div>
            </section>

            {payments.length > 0 && (
              <section className="rounded-[1.5rem] border border-ink/10 bg-white p-5">
                <h2 className="text-base font-extrabold">Transactions</h2>
                <div className="mt-3 space-y-2">
                  {payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between gap-3 border-b border-ink/5 py-2 text-xs"
                    >
                      <span className="capitalize text-ink/55">
                        {String(payment.payment_type)
                          .replaceAll("_", " ")
                          .toLowerCase()}
                      </span>
                      <span className="font-bold">{money(payment.amount)}</span>
                      <span
                        className={
                          "rounded-full px-2 py-1 font-bold " +
                          (payment.status === "PAID"
                            ? "bg-mesh-50 text-mesh-700"
                            : "bg-amber-50 text-amber-700")
                        }
                      >
                        {payment.status}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </div>

      {/* EXTEND RENTAL MODAL */}
      {showExtendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-[1.8rem] border border-ink/10 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="text-mesh-600" size={20} />
                <h2 className="text-lg font-black">Extend Rental</h2>
              </div>
              <button
                onClick={() => setShowExtendModal(false)}
                className="rounded-full p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Select additional days. The owner will be notified to review and approve.
            </p>

            <form onSubmit={handleRequestExtension} className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-bold text-ink/60">
                  Select additional days
                </label>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {[1, 2, 3, 7].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setExtendingDays(num)}
                      className={`rounded-xl border py-2.5 text-xs font-black transition ${
                        Number(extendingDays) === num
                          ? "border-mesh-600 bg-mesh-600 text-white shadow-sm"
                          : "border-ink/15 bg-paper hover:bg-white"
                      }`}
                    >
                      +{num} day{num > 1 ? "s" : ""}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-xs text-ink/50">Or custom days:</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={extendingDays}
                    onChange={(e) => setExtendingDays(e.target.value)}
                    className="h-8 w-20 rounded-lg border border-ink/15 bg-paper px-2 text-center text-xs font-bold"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-mesh-200 bg-mesh-50 p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-ink/60">Daily rate:</span>
                  <b className="font-bold">{money(dailyRate)}/day</b>
                </div>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-ink/60">Additional rental fee:</span>
                  <b className="text-sm font-black text-mesh-800">
                    {money(estimatedExtensionFee)}
                  </b>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-ink/60">
                  Reason for extension (optional)
                </label>
                <textarea
                  rows="2"
                  value={extendingReason}
                  onChange={(e) => setExtendingReason(e.target.value)}
                  placeholder="e.g., Still finishing project work with this item"
                  className="mt-1 w-full rounded-xl border border-ink/15 bg-paper p-2.5 text-xs focus:border-mesh-500 focus:outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExtendModal(false)}
                  className="flex-1 rounded-xl border border-ink/15 py-2.5 text-xs font-extrabold text-ink/70 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={extendingLoading}
                  className="flex-1 rounded-xl bg-mesh-600 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700 disabled:opacity-50"
                >
                  {extendingLoading ? "Submitting…" : "Send extension request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RETURN ITEM MODAL */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-[1.8rem] border border-ink/10 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="text-mesh-600" size={20} />
                <h2 className="text-lg font-black">Initiate Item Return</h2>
              </div>
              <button
                onClick={() => setShowReturnModal(false)}
                className="rounded-full p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Choose how you will return the item to {rental.owner_name}.
            </p>

            <form onSubmit={handleInitiateReturn} className="mt-5 space-y-3">
              <label
                onClick={() => setReturnMode("DIRECT")}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                  returnMode === "DIRECT"
                    ? "border-mesh-600 bg-mesh-50/70 shadow-sm"
                    : "border-ink/15 bg-paper hover:bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="returnMode"
                  checked={returnMode === "DIRECT"}
                  onChange={() => setReturnMode("DIRECT")}
                  className="mt-1 text-mesh-600"
                />
                <div>
                  <b className="block text-sm font-extrabold text-ink">
                    Direct in-person return (Free)
                  </b>
                  <p className="mt-1 text-xs leading-relaxed text-ink/55">
                    Hand over the item directly to the owner on campus. The owner inspects it and confirms the return.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setReturnMode("COURIER")}
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                  returnMode === "COURIER"
                    ? "border-mesh-600 bg-mesh-50/70 shadow-sm"
                    : "border-ink/15 bg-paper hover:bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="returnMode"
                  checked={returnMode === "COURIER"}
                  onChange={() => setReturnMode("COURIER")}
                  className="mt-1 text-mesh-600"
                />
                <div>
                  <b className="block text-sm font-extrabold text-ink">
                    Campus courier return
                  </b>
                  <p className="mt-1 text-xs leading-relaxed text-ink/55">
                    A campus courier collects the item from your room and delivers it back to the owner with live tracking and QR verification.
                  </p>
                </div>
              </label>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  className="flex-1 rounded-xl border border-ink/15 py-2.5 text-xs font-extrabold text-ink/70 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={returnLoading}
                  className="flex-1 rounded-xl bg-mesh-600 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700 disabled:opacity-50"
                >
                  {returnLoading ? "Initiating…" : "Confirm return method"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OWNER INSPECTION & REFUND MODAL */}
      {showInspectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-[1.8rem] border border-ink/10 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-mesh-600" size={20} />
                <h2 className="text-lg font-black">
                  Item Inspection & Deposit Settlement
                </h2>
              </div>
              <button
                onClick={() => setShowInspectionModal(false)}
                className="rounded-full p-1 text-ink/40 hover:bg-ink/5 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Confirm item receipt from {rental.borrower_name}. {rental.payment_method==='DIRECT_UPI'?'This records the return. You must send the deposit refund separately using UPI.':'Process the refundable security deposit.'}
            </p>

            <form onSubmit={handleConfirmReturn} className="mt-5 space-y-4">
              <div className="rounded-2xl border border-ink/10 bg-paper p-4">
                <div className="flex justify-between text-xs">
                  <span className="text-ink/60">Security deposit held:</span>
                  <b className="font-extrabold text-ink">{money(rental.deposit_amount)}</b>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-ink/60">
                  Item condition check
                </label>
                <div className="mt-2 space-y-2">
                  <label
                    onClick={() => setHasDamage(false)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold transition ${
                      !hasDamage
                        ? "border-mesh-600 bg-mesh-50 text-mesh-900"
                        : "border-ink/15 bg-paper hover:bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="condition"
                      checked={!hasDamage}
                      onChange={() => setHasDamage(false)}
                      className="text-mesh-600"
                    />
                    <span>Good condition (Full 100% deposit refund to renter)</span>
                  </label>

                  <label
                    onClick={() => setHasDamage(true)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-xs font-bold transition ${
                      hasDamage
                        ? "border-amber-600 bg-amber-50 text-amber-950"
                        : "border-ink/15 bg-paper hover:bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="condition"
                      checked={hasDamage}
                      onChange={() => setHasDamage(true)}
                      className="text-amber-600"
                    />
                    <span>Item has damage / issues (Deduct from deposit)</span>
                  </label>
                </div>
              </div>

              {hasDamage && (
                <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 animate-in fade-in">
                  <div>
                    <label className="text-xs font-bold text-amber-950">
                      Damage deduction amount (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={rental.deposit_amount}
                      value={damageAmount}
                      onChange={(e) => setDamageAmount(e.target.value)}
                      placeholder="e.g., 50.00"
                      className="mt-1 w-full rounded-xl border border-amber-300 bg-white p-2.5 text-xs font-bold focus:outline-none"
                      required={hasDamage}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-amber-950">
                      Damage description
                    </label>
                    <textarea
                      rows="2"
                      value={damageDesc}
                      onChange={(e) => setDamageDesc(e.target.value)}
                      placeholder="Describe the condition or missing parts"
                      className="mt-1 w-full rounded-xl border border-amber-300 bg-white p-2.5 text-xs focus:outline-none"
                      required={hasDamage}
                    />
                  </div>
                </div>
              )}

              {/* Settlement Summary */}
              <div className="rounded-2xl border border-ink/10 bg-white p-4 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-ink/60">Deduction retained by you:</span>
                  <b className="font-bold text-amber-700">
                    {money(hasDamage ? parseFloat(damageAmount) || 0 : 0)}
                  </b>
                </div>
                <div className="flex justify-between border-t border-ink/10 pt-2 text-sm">
                  <span className="font-bold text-ink">Refunded to renter:</span>
                  <b className="font-black text-mesh-700">
                    {money(
                      Math.max(
                        0,
                        Number(rental.deposit_amount) -
                          (hasDamage ? parseFloat(damageAmount) || 0 : 0),
                      ),
                    )}
                  </b>
                </div>
              </div>

              {rental.payment_method==='DIRECT_UPI' && <label className="flex items-start gap-3 text-sm leading-6">
                <input type="checkbox" required checked={conditionConfirmed} onChange={e=>setConditionConfirmed(e.target.checked)} className="mt-1.5" />
                I received this item and inspected its condition before approving the deposit refund.
              </label>}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInspectionModal(false)}
                  className="flex-1 rounded-xl border border-ink/15 py-2.5 text-xs font-extrabold text-ink/70 hover:bg-paper"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inspectLoading || (rental.payment_method==='DIRECT_UPI' && !conditionConfirmed)}
                  className="flex-1 rounded-xl bg-mesh-600 py-2.5 text-xs font-extrabold text-white shadow-sm transition hover:bg-mesh-700 disabled:opacity-50"
                >
                  {inspectLoading
                    ? "Recording inspection…"
                    : rental.payment_method==='DIRECT_UPI'?'Approve return & prepare refund': 'Confirm return & refund'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
