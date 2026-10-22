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
import { useAuth } from "./context/AuthContext";
import PayoutsPage from "./features/payouts/PayoutsPage";
import AccountPage from "./features/account/AccountPage";
import LandingPage from "./features/landing/LandingPage";
import ListingDetailsPage from "./features/marketplace/ListingDetailsPage";
import MarketplacePage from "./features/marketplace/MarketplacePage";
import AddListing from "./pages/AddListing";
import Cart from "./features/cart/CartPage";
import Checkout from "./features/cart/CheckoutPage";
import ChooseMode from "./features/auth/ChooseModePage";
import DeliveryPage from "./features/delivery/DeliveryPage";
import DeliveryTracking from "./features/delivery/DeliveryTrackingPage";
import DepositPayment from "./pages/DepositPayment";
import EditListing from "./pages/EditListing";
import ForgotPassword from "./features/auth/ForgotPasswordPage";
import Login from "./features/auth/LoginPage";
import PaymentFailed from "./pages/PaymentFailed";
import PaymentSuccess from "./pages/PaymentSuccess";
import RentalPayment from "./pages/RentalPayment";
import RentalReturn from "./pages/RentalReturn";
import RentDetails from "./pages/RentDetails";
import RentSummary from "./pages/RentSummary";
import Signup from "./features/auth/SignupPage";
import VerifyEmail from "./features/auth/VerifyEmailPage";
import WishBoxPage from "./features/wishes/WishBoxPage";
import InsightsPage from "./features/intelligence/InsightsPage";
import SupportPage from "./features/support/SupportPage";
import ReminderPage from "./features/support/ReminderPage";
import PrintSoon from "./features/wishes/PrintSoon";

const Protected = ({ children }) => <PrivateRoute>{children}</PrivateRoute>;
const LegacyListingRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/item/${id}`} replace />;
};

export default function App() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return (
    <>
      <AppNavbar />
      {user && pathname !== "/support" && (
        <Link
          to="/support"
          aria-label="Customer support"
          className="fixed bottom-22 right-4 z-30 rounded-full border border-mesh-200 bg-white px-4 py-3 text-xs font-semibold text-mesh-700 shadow-md lg:bottom-5"
        >
          Need help?
        </Link>
      )}
      <Routes>
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
    </>
  );
}
