import { useEffect, useRef } from "react";
import Brand from "../Brand";
import { Link, useLocation } from "react-router-dom";
import {
  ShoppingBag,
  Store,
  Truck,
  LogOut,
  ArrowUpRight,
  Sparkles,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import DeliveryNotifications from "../DeliveryNotifications";

const workspaces = [
  ["/marketplace", "Rent", ShoppingBag],
  ["/lend", "Lend", Store],
  ["/delivery", "Deliver", Truck],
  ["/wish-box", "Wish Box", Sparkles],
];
export default function AppNavbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const secondaryNav = useRef(null);
  useEffect(() => {
    const nav = secondaryNav.current;
    const active = nav?.querySelector('[aria-current="page"]');
    if (active) {
      const item = active.getBoundingClientRect(),
        container = nav.getBoundingClientRect();
      if (item.left < container.left || item.right > container.right) {
        nav.scrollLeft += item.left - container.left - 20;
      }
    }
  }, [pathname, user]);
  if (
    ["/login", "/signup", "/verify-email", "/forgot-password"].includes(
      pathname,
    )
  )
    return null;
  const workspace = pathname.startsWith("/wish-box")
    ? "Wish Box"
    : pathname.startsWith("/delivery")
      ? "Deliver"
      : [
            "/lend",
            "/account/listings",
            "/add-listing",
            "/edit-listing",
            "/owner-dashboard",
          ].some((p) => pathname.startsWith(p))
        ? "Lend"
        : "Rent";
  const links =
    workspace === "Wish Box"
      ? [
          ["/wish-box", "My requests"],
          ["/delivery/wishes", "Help with an errand"],
        ]
      : workspace === "Deliver"
        ? [
            ["/delivery", "Delivery dashboard"],
            ["/delivery/wishes", "Wish Box errands"],
          ]
        : workspace === "Lend"
          ? [
              ["/lend", "Lending dashboard"],
              ["/add-listing", "List an item"],
            ]
          : [
              ["/marketplace", "Browse items"],
              ["/account/rentals", "My rentals"],
              ["/account/saved", "Saved"],
              ["/cart", "Cart"],
            ];
  links.push(
    ["/payouts", "Payments"],
    ["/insights", "Insights"],
    ["/reminders", "Reminders"],
    ["/support", "Support"],
    ["/voice", "Voice assistant"],
  );
  const isActiveLink = (to) =>
    pathname === to ||
    (to === "/account/rentals" &&
      ["/rent-details/", "/rental-payment/", "/deposit-payment/", "/rental-return/"].some(
        (prefix) => pathname.startsWith(prefix),
      ));
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-ink/15 bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-3 sm:h-17 sm:gap-4 sm:px-8">
          <Link to={user ? "/choose-mode" : "/"} className="mr-auto text-lg">
            <Brand />
          </Link>
          {user ? (
            <>
              <nav
                aria-label="Workspaces"
                className="hidden items-center gap-1 rounded-xl border border-ink/10 bg-paper p-1 lg:flex"
              >
                {workspaces.map(([to, label, Icon]) => (
                  <Link
                    key={to}
                    to={to}
                    aria-current={workspace === label ? "page" : undefined}
                    className={`flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mesh-700 ${workspace === label ? "bg-mesh-700 text-white shadow-sm" : "text-ink hover:bg-white"}`}
                  >
                    <Icon size={17} strokeWidth={2.25} />
                    {label}
                  </Link>
                ))}
                <span
                  aria-disabled="true"
                  title="Coming soon"
                  className="flex items-center gap-1.5 px-2 text-xs font-semibold text-ink/65"
                >
                  <LockKeyhole size={13} />
                  Print <span className="rounded bg-white px-1.5 py-1 text-[10px]">Coming soon</span>
                </span>
              </nav>
              <DeliveryNotifications />
              <Link
                to="/account/settings"
                aria-label="Account settings"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-ink/20 bg-paper text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mesh-700"
              >
                {user.name
                  ?.split(" ")
                  .map((x) => x[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "CM"}
              </Link>
              <button
                onClick={logout}
                aria-label="Log out"
                title="Log out"
                className="grid size-11 shrink-0 place-items-center rounded-lg text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mesh-700"
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-sm font-semibold">
                Log in
              </Link>
              <Link to="/signup" className="brand-button text-sm">
                Get started <ArrowUpRight size={16} />
              </Link>
            </>
          )}
        </div>
        {user && pathname !== "/choose-mode" && (
          <nav
            aria-label={`${workspace} navigation`}
            className="border-t border-ink/10"
          >
            <div
              ref={secondaryNav}
              className="mx-auto flex max-w-[1240px] gap-5 overflow-x-auto px-5 sm:gap-6 sm:px-8"
            >
              {links.map(([to, label]) => (
                <Link
                  key={to}
                  to={to}
                  aria-current={isActiveLink(to) ? "page" : undefined}
                  className={`shrink-0 border-b-[3px] px-1 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mesh-700 ${isActiveLink(to) ? "border-mesh-700 text-mesh-700" : "border-transparent text-ink hover:border-ink/30 hover:text-mesh-700"}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>
      {user && (
        <nav
          aria-label="Mobile workspaces"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-ink/15 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_#2025220a] lg:hidden"
        >
          {workspaces.map(([to, label, Icon]) => (
            <Link
              key={to}
              to={to}
              aria-current={workspace === label ? "page" : undefined}
              className={`flex flex-col items-center gap-1 border-t-[3px] py-3 text-xs font-bold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mesh-700 ${workspace === label ? "border-mesh-700 bg-mesh-100 text-mesh-800" : "border-transparent text-ink"}`}
            >
              <Icon size={21} strokeWidth={2.25} />
              {label}
            </Link>
          ))}
          <span
            aria-disabled="true"
            className="flex flex-col items-center gap-1 border-t-[3px] border-transparent py-3 text-[10px] font-semibold text-ink/65"
          >
            <LockKeyhole size={20} />
            Print · Soon
          </span>
        </nav>
      )}
    </>
  );
}
