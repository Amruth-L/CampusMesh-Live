import { lazy, Suspense, Component, useLayoutEffect } from 'react';
import { useNavigationType } from 'react-router-dom';
import {
  Navigate,
  Route,
  Routes,
  useParams,
  useLocation,
  Link,
} from "react-router-dom";
import AppNavbar from "./components/layout/AppNavbar";
import PrivateRoute from "./components/PrivateRoute";
import { useAuth } from "./context/auth-context";
const PayoutsPage = lazy(() => import("./features/payouts/PayoutsPage"));
const AccountPage = lazy(() => import("./features/account/AccountPage"));
const LandingPage = lazy(() => import("./features/landing/LandingPage"));
const ListingDetailsPage = lazy(() => import("./features/marketplace/ListingDetailsPage"));
const MarketplacePage = lazy(() => import("./features/marketplace/MarketplacePage"));
const AddListing = lazy(() => import("./pages/AddListing"));
const Cart = lazy(() => import("./features/cart/CartPage"));
const Checkout = lazy(() => import("./features/cart/CheckoutPage"));
const ChooseMode = lazy(() => import("./features/auth/ChooseModePage"));
const DeliveryPage = lazy(() => import("./features/delivery/DeliveryPage"));
const DeliveryTracking = lazy(() => import("./features/delivery/DeliveryTrackingPage"));
const DepositPayment = lazy(() => import("./pages/DepositPayment"));
const EditListing = lazy(() => import("./pages/EditListing"));
const ForgotPassword = lazy(() => import("./features/auth/ForgotPasswordPage"));
const Login = lazy(() => import("./features/auth/LoginPage"));
const PaymentFailed = lazy(() => import("./pages/PaymentFailed"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const RentalPayment = lazy(() => import("./pages/RentalPayment"));
const RentalReturn = lazy(() => import("./pages/RentalReturn"));
const RentDetails = lazy(() => import("./pages/RentDetails"));
const RentSummary = lazy(() => import("./pages/RentSummary"));
const Signup = lazy(() => import("./features/auth/SignupPage"));
const VerifyEmail = lazy(() => import("./features/auth/VerifyEmailPage"));
const WishBoxPage = lazy(() => import("./features/wishes/WishBoxPage"));
const InsightsPage = lazy(() => import("./features/intelligence/InsightsPage"));
const SupportPage = lazy(() => import("./features/support/SupportPage"));
const ReminderPage = lazy(() => import("./features/support/ReminderPage"));
const PrintSoon = lazy(() => import("./features/wishes/PrintSoon"));
const VoicePage = lazy(() => import("./features/voice/VoicePage"));
import VoiceWelcomePrompt from "./features/voice/VoiceWelcomePrompt";

const Protected = ({ children }) => <PrivateRoute>{children}</PrivateRoute>;
const LegacyListingRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/item/${id}`} replace />;
};

class RouteError extends Component {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() { return this.state.failed ? <section role="alert" className="page-shell"><h1 className="page-title">This page could not load</h1><p>Reload to retry. Your saved activity is unchanged.</p><button className="brand-button mt-4" onClick={()=>window.location.reload()}>Reload page</button></section> : this.props.children; }
}
const scrollPositions = new Map();
function RouteScroll() {
  const location = useLocation(), navigation = useNavigationType();
  useLayoutEffect(()=> {
    const previous=history.scrollRestoration;history.scrollRestoration='manual';
    const position=navigation==='POP' ? scrollPositions.get(location.key) || [0,0] : [0,0];
    window.scrollTo(...position);
    const save=()=>scrollPositions.set(location.key,[window.scrollX,window.scrollY]);
    window.addEventListener('scroll',save,{passive:true});
    return ()=>{window.removeEventListener('scroll',save);history.scrollRestoration=previous;};
  },[location.key,navigation]);
  return null;
}

export default function App() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return (
    <>
      <AppNavbar />
      <RouteScroll />
      <VoiceWelcomePrompt />
      {user && pathname !== "/voice" && (
        <Link
          to="/voice"
          aria-label="Need help? Open voice assistant"
          className="hidden lg:block fixed bottom-22 right-4 z-30 rounded-full border border-mesh-200 bg-white px-4 py-3 text-xs font-semibold text-mesh-700 shadow-md lg:bottom-5"
        >
          Need help?
        </Link>
      )}
      <div className="route-content"><RouteError key={pathname}><Suspense fallback={<div role="status" className="page-shell">Loading page…</div>}>
      <Routes>
        <Route path="/voice" element={<Protected><VoicePage /></Protected>} />
        <Route path="/payouts" element={<Protected><PayoutsPage /></Protected>} />
        <Route
          path="/insights"
          element={
            <Protected>
              <InsightsPage />
            </Protected>
          }
        />
        <Route
          path="/support"
          element={
            <Protected>
              <SupportPage />
            </Protected>
          }
        />
        <Route
          path="/reminders"
          element={
            <Protected>
              <ReminderPage />
            </Protected>
          }
        />
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={<Login />}
        />
        <Route
          path="/signup"
          element={user ? <Navigate to="/" replace /> : <Signup />}
        />
        <Route
          path="/verify-email"
          element={user ? <Navigate to="/" replace /> : <VerifyEmail />}
        />
        <Route
          path="/forgot-password"
          element={user ? <Navigate to="/" replace /> : <ForgotPassword />}
        />
        <Route
          path="/choose-mode"
          element={
            <Protected>
              <ChooseMode />
            </Protected>
          }
        />
        <Route
          path="/marketplace"
          element={
            <Protected>
              <MarketplacePage />
            </Protected>
          }
        />
        <Route
          path="/item/:id"
          element={
            <Protected>
              <ListingDetailsPage />
            </Protected>
          }
        />
        <Route path="/rent-item/:id" element={<LegacyListingRedirect />} />
        <Route path="/rent/:id" element={<LegacyListingRedirect />} />
        <Route
          path="/lend"
          element={
            <Protected>
              <AccountPage workspace="lend" />
            </Protected>
          }
        />
        <Route
          path="/account/:tab"
          element={
            <Protected>
              <AccountPage />
            </Protected>
          }
        />
        <Route
          path="/account"
          element={<Navigate to="/account/rentals" replace />}
        />
        <Route
          path="/profile"
          element={<Navigate to="/account/settings" replace />}
        />
        <Route
          path="/my-rentals"
          element={<Navigate to="/account/rentals" replace />}
        />
        <Route
          path="/my-listings"
          element={<Navigate to="/account/listings" replace />}
        />
        <Route
          path="/saved-items"
          element={<Navigate to="/account/saved" replace />}
        />
        <Route
          path="/add-listing"
          element={
            <Protected>
              <AddListing />
            </Protected>
          }
        />
        <Route
          path="/create-listing"
          element={
            <Protected>
              <AddListing />
            </Protected>
          }
        />
        <Route
          path="/edit-listing/:id"
          element={
            <Protected>
              <EditListing />
            </Protected>
          }
        />
        <Route
          path="/cart"
          element={
            <Protected>
              <Cart />
            </Protected>
          }
        />
        <Route
          path="/checkout"
          element={
            <Protected>
              <Checkout />
            </Protected>
          }
        />
        <Route
          path="/rent-summary/:id"
          element={
            <Protected>
              <RentSummary />
            </Protected>
          }
        />
        <Route
          path="/rent-details/:rentalId"
          element={
            <Protected>
              <RentDetails />
            </Protected>
          }
        />
        <Route
          path="/owner-dashboard"
          element={
            <Protected>
              <Navigate to="/lend" replace />
            </Protected>
          }
        />
        <Route
          path="/rental-return/:rentalId"
          element={
            <Protected>
              <RentalReturn />
            </Protected>
          }
        />
        <Route
          path="/rental-payment/:id"
          element={
            <Protected>
              <RentalPayment />
            </Protected>
          }
        />
        <Route
          path="/deposit-payment/:id"
          element={
            <Protected>
              <DepositPayment />
            </Protected>
          }
        />
        <Route
          path="/payment-success"
          element={
            <Protected>
              <PaymentSuccess />
            </Protected>
          }
        />
        <Route
          path="/payment-failed"
          element={
            <Protected>
              <PaymentFailed />
            </Protected>
          }
        />
        <Route
          path="/wish-box"
          element={
            <Protected>
              <WishBoxPage />
            </Protected>
          }
        />
        <Route
          path="/delivery/wishes"
          element={
            <Protected>
              <WishBoxPage courier />
            </Protected>
          }
        />
        <Route
          path="/print"
          element={
            <Protected>
              <PrintSoon />
            </Protected>
          }
        />
        <Route
          path="/delivery"
          element={
            <Protected>
              <DeliveryPage />
            </Protected>
          }
        />
        <Route
          path="/delivery/:id/track"
          element={
            <Protected>
              <DeliveryTracking />
            </Protected>
          }
        />
        <Route
          path="/xerox"
          element={
            <Protected>
              <PrintSoon />
            </Protected>
          }
        />
        <Route
          path="*"
          element={<Navigate to={user ? "/choose-mode" : "/"} replace />}
        />
      </Routes>
      </Suspense></RouteError>
      {user && pathname !== "/voice" && <div className="px-5 py-6 lg:hidden"><Link className="secondary-button" to="/voice">Need help? Voice assistant</Link></div>}
      </div>
    </>
  );
}
