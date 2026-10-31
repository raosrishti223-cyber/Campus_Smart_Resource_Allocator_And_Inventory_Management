"use client";

import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, Boxes,
  Building2, Check, ChevronDown, CircleHelp, ClipboardList, Clock3, FileText,
  LayoutDashboard, LogOut, Package, PackageCheck, Plus, Search, Shield, Sparkles, Truck,
  UserRoundPlus, Users, Wrench, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { getLocalDateString } from "@/lib/date";

type ResourceLocation = {
  locationId: string;
  locationName: string;
  departmentId: string | null;
  departmentName: string | null;
  onHand: number;
  checkedOut: number;
  myCheckedOut: number;
  myAvailableAllocation: number;
  minimumRequired: number;
  reorderLevel: number;
};
type Resource = {
  resource_id: string;
  sku: string;
  resource_name: string;
  category_name: string;
  unit: string;
  resource_type: "REUSABLE" | "CONSUMABLE";
  total_on_hand: number;
  total_checked_out: number;
  campus_minimum: number;
  reallocatable: number;
  is_low_stock: boolean;
  locations: ResourceLocation[];
};
type ResourceRequest = {
  request_id: number | string;
  requested_by?: number | string;
  department_name: string;
  resource_id: number | string;
  resource_name: string;
  unit: string;
  quantity: number;
  fulfilled_quantity: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  status: string;
  needed_by: string | null;
  purpose: string;
  requester_name: string;
  withdrawn_by_name?: string | null;
  created_at: string;
};
type DashboardData = {
  metrics: {
    resourceTypes: number;
    unitsOnCampus: number;
    lowStockResources: number;
    pendingRequests: number;
    reallocationOpportunities: number;
  };
  recentRequests: ResourceRequest[];
};
type Report = {
  reportId: string;
  resourceName: string;
  title: string;
  condition: string;
  severity: string;
  notes: string;
  status: string;
  reportedBy: { userId: string; name: string };
  statusUpdatedBy?: { userId: string; name: string };
  createdAt: string;
};
type ReportSummary = {
  severity: string;
  status: string;
  count: number;
};
type Recommendation = {
  request: {
    requestId: string;
    resourceName: string;
    unit: string;
    unfulfilledQuantity: number;
    destinationLocationId: string;
    destinationLocationName: string;
    requesterName: string;
  };
  options: Array<{
    locationId: string;
    locationName: string;
    onHand: number;
    checkedOut: number;
    minimumRequired: number;
    availableSurplus: number;
    recommendedQuantity: number;
  }>;
  procurementQuantity: number;
};
type Department = { departmentId: string; name: string };
type ManagedAccount = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  departmentName: string;
  isActive: boolean;
};
type CheckoutRecord = {
  resourceId: string;
  resourceName: string;
  unit: string;
  locationName: string;
  locationDepartment: string;
  holderName: string;
  holderDepartment: string;
  quantity: number;
};
type UnassignedCheckout = {
  resourceName: string;
  unit: string;
  locationName: string;
  locationDepartment: string;
  quantity: number;
};
type ProcurementRecord = {
  procurementId: string;
  requestId: string | null;
  requestStatus: string | null;
  resourceId: string;
  resourceName: string;
  unit: string;
  quantity: number;
  status: "RECOMMENDED" | "ORDERED" | "RECEIVED" | "CANCELLED";
  justification: string;
  supplier: string;
  recommendedBy: string;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
  receivedLocationId: string | null;
  receivedLocationName: string | null;
  preferredLocationId: string | null;
};
type ProcurementLocation = {
  locationId: string;
  name: string;
  locationType: string;
  departmentId: string | null;
};
type Section = "overview" | "inventory" | "requests" | "reports" | "checkouts" | "procurement" | "accounts";

const navItems: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "requests", label: "Requests & transfers", icon: ClipboardList },
  { id: "reports", label: "Condition reports", icon: Wrench },
  { id: "checkouts", label: "Currently checked out", icon: PackageCheck },
  { id: "procurement", label: "Procurement", icon: Truck },
  { id: "accounts", label: "User accounts", icon: Users },
];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result as T;
}

function formatDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

function Badge({ children, kind = "" }: { children: ReactNode; kind?: string }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Dashboard({ user }: { user: SessionUser }) {
  const [section, setSection] = useState<Section>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [requests, setRequests] = useState<ResourceRequest[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [reportSummary, setReportSummary] = useState<ReportSummary[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, Recommendation>>({});
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const refresh = useCallback(async () => {
    const [dashboardResult, resourcesResult, requestsResult, reportsResult] = await Promise.allSettled([
      api<DashboardData>("/api/dashboard"),
      api<{ resources: Resource[] }>("/api/resources"),
      api<{ requests: ResourceRequest[] }>("/api/requests"),
      api<{ reports: Report[]; summary: ReportSummary[] }>("/api/reports"),
    ]);
    const failures: string[] = [];
    if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value);
    else failures.push(`Dashboard: ${dashboardResult.reason instanceof Error ? dashboardResult.reason.message : "Failed to load."}`);
    if (resourcesResult.status === "fulfilled") setResources(resourcesResult.value.resources);
    else failures.push(`Inventory: ${resourcesResult.reason instanceof Error ? resourcesResult.reason.message : "Failed to load."}`);
    if (requestsResult.status === "fulfilled") setRequests(requestsResult.value.requests);
    else failures.push(`Requests: ${requestsResult.reason instanceof Error ? requestsResult.reason.message : "Failed to load."}`);
    if (reportsResult.status === "fulfilled") {
      setReports(reportsResult.value.reports);
      setReportSummary(reportsResult.value.summary);
    }
    else failures.push(`Condition reports: ${reportsResult.reason instanceof Error ? reportsResult.reason.message : "Failed to load."}`);
    setErrors(failures);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initialLoad = async () => { await refresh(); };
    void initialLoad();
  }, [refresh]);

  const refreshReports = useCallback(async () => {
    try {
      const result = await api<{ reports: Report[]; summary: ReportSummary[] }>("/api/reports");
      setReports(result.reports);
      setReportSummary(result.summary);
      setErrors((current) => current.filter((error) => !error.startsWith("Condition reports:")));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to load.";
      setErrors((current) => [
        ...current.filter((error) => !error.startsWith("Condition reports:")),
        `Condition reports: ${message}`,
      ]);
    }
  }, []);

  useEffect(() => {
    if (section !== "reports") return;
    const loadReports = async () => { await refreshReports(); };
    void loadReports();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshReports();
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [refreshReports, section]);

  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const result = await api<{ departments: Department[]; accounts: ManagedAccount[] }>("/api/admin/accounts");
      setDepartments(result.departments);
      setAccounts(result.accounts);
    } catch (cause) {
      setNotice({ message: cause instanceof Error ? cause.message : "Could not load user accounts.", kind: "error" });
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadAccounts = async () => { await refreshAccounts(); };
    if (section === "accounts" && user.role === "ADMIN") void loadAccounts();
  }, [refreshAccounts, section, user.role]);

  const filteredResources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return resources;
    return resources.filter((resource) =>
      [resource.resource_name, resource.sku, resource.category_name].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [query, resources]);

  async function perform<T>(key: string, action: () => Promise<T>, success: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
      setNotice({ message: success, kind: "success" });
      await refresh();
      return true;
    } catch (cause) {
      setNotice({ message: cause instanceof Error ? cause.message : "The action failed.", kind: "error" });
      return false;
    } finally {
      setBusyKey("");
    }
  }

  async function loadRecommendation(requestId: string, clearNotice = true) {
    setBusyKey(`recommendation-${requestId}`);
    if (clearNotice) setNotice(null);
    try {
      const result = await api<Recommendation>(`/api/recommendations?requestId=${encodeURIComponent(requestId)}`);
      setRecommendations((current) => ({ ...current, [requestId]: result }));
      setExpandedRequest(requestId);
    } catch (cause) {
      setNotice({ message: cause instanceof Error ? cause.message : "Could not calculate a recommendation.", kind: "error" });
    } finally {
      setBusyKey("");
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  const metrics = dashboard?.metrics;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="CampusFlow home">
          <span className="brand-icon"><Boxes size={21} /></span>
          <span>Campus<span className="brand-soft">Flow</span></span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="campus-switcher">
          <span className="campus-mark"><Building2 size={17} /></span>
          <span><strong>RR Campus</strong><small>Resource operations</small></span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">OPERATIONS</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.filter((item) => !["accounts", "checkouts", "procurement"].includes(item.id) || user.role === "ADMIN").map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}>
              <Icon size={17} /><span>{item.label}</span>
              {item.id === "requests" && metrics?.pendingRequests ? <span className="nav-count">{metrics.pendingRequests}</span> : null}
            </button>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Sparkles size={17} /></div>
          <strong>Allocate before you buy</strong>
          <p>Check campus-wide surplus before new procurement.</p>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{user.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
          <div className="user-meta"><strong>{user.fullName}</strong><span>{user.role === "ADMIN" ? "Administrator" : `${user.departmentName ?? "No department"} · ${user.role === "STUDENT" ? "Student" : "Staff"}`}</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><button type="button" className="breadcrumb-home" onClick={() => setSection("overview")}>Campus operations</button><ArrowRight size={13} /><strong>{navItems.find((item) => item.id === section)?.label}</strong></div>
          <div className="topbar-right"><span className={`system-status ${errors.length > 0 ? "system-error" : loading ? "system-checking" : ""}`}><span /> {errors.length > 0 ? "Connection issue" : loading ? "Checking services" : "Services connected"}</span><span className="topbar-divider" /><div className="avatar avatar-small">{user.fullName[0]}</div><button className="button button-secondary topbar-signout" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button></div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">{section === "overview" ? "CAMPUS RESOURCE INTELLIGENCE" : "RESOURCE OPERATIONS"}</div>
              <h1>{section === "overview" ? "Good to see you, " : ""}{section === "overview" ? user.fullName.split(" ")[0] : navItems.find((item) => item.id === section)?.label}<span className="heading-dot">.</span></h1>
              <p>{section === "overview" ? "A clear view of campus stock, active needs, and where to move resources next." : section === "inventory" ? "Search and compare on-hand stock across departments and locations." : section === "requests" ? "Prioritize needs and move available stock before creating a purchase." : section === "reports" ? "Capture flexible condition and maintenance details for campus assets." : section === "checkouts" ? "See who currently holds reusable campus resources and reconcile unassigned checkouts." : section === "procurement" ? "Track recommended orders and record incoming stock into campus inventory." : "Create staff and student accounts and assign them to campus departments."}</p>
            </div>
            <button className="button button-secondary refresh-button" onClick={() => { setLoading(true); void refresh(); if (section === "accounts" && user.role === "ADMIN") void refreshAccounts(); }} disabled={loading}><Activity size={15} /> {loading ? "Refreshing" : "Refresh data"}</button>
          </div>

          {errors.length > 0 && <div className="alert alert-error"><AlertTriangle size={17} /><div><strong>Some data could not be loaded</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div></div>}
          {notice && <div className={`alert ${notice.kind === "error" ? "alert-error" : "alert-success"}`}><span>{notice.kind === "error" ? <X size={17} /> : <Check size={17} />}</span><span>{notice.message}</span><button className="alert-close" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

          {section === "overview" && <Overview dashboard={dashboard} loading={loading} onOpenRequests={() => setSection("requests")} onOpenInventory={() => setSection("inventory")} />}
          {section === "inventory" && <Inventory resources={filteredResources} query={query} setQuery={setQuery} loading={loading} user={user} busyKey={busyKey} onPerform={perform} />}
          {section === "requests" && <RequestsPanel
            requests={requests}
            resources={resources}
            user={user}
            loading={loading}
            expandedRequest={expandedRequest}
            recommendations={recommendations}
            busyKey={busyKey}
            onLoadRecommendation={loadRecommendation}
            onPerform={perform}
          />}
          {section === "reports" && <ReportsPanel reports={reports} summary={reportSummary} resources={resources} user={user} busyKey={busyKey} onPerform={perform} />}
          {section === "checkouts" && user.role === "ADMIN" && <CheckedOutPanel />}
          {section === "procurement" && user.role === "ADMIN" && <ProcurementPanel busyKey={busyKey} onPerform={perform} onOpenRequest={(requestId) => { setSection("requests"); void loadRecommendation(requestId); }} />}
          {section === "accounts" && user.role === "ADMIN" && <AccountsPanel
            accounts={accounts}
            departments={departments}
            loading={accountsLoading}
            busyKey={busyKey}
            onPerform={perform}
            onRefresh={refreshAccounts}
          />}
          <footer className="page-footer"><span>CampusFlow <span className="footer-separator">/</span> Campus Smart Resource Allocation</span><span>Resource decisions, backed by live stock data</span></footer>
        </div>
      </main>
    </div>
  );
}

function Overview({ dashboard, loading, onOpenRequests, onOpenInventory }: { dashboard: DashboardData | null; loading: boolean; onOpenRequests: () => void; onOpenInventory: () => void }) {
  const metrics = dashboard?.metrics;
  const cards = [
    { label: "Resource types", value: metrics?.resourceTypes, icon: Package, tone: "blue", caption: "Tracked across locations" },
    { label: "Units on campus", value: metrics?.unitsOnCampus, icon: Boxes, tone: "violet", caption: "Total recorded stock" },
    { label: "Low stock", value: metrics?.lowStockResources, icon: AlertTriangle, tone: "amber", caption: "At or below reorder level" },
    { label: "Open requests", value: metrics?.pendingRequests, icon: ClipboardList, tone: "green", caption: "Need a fulfillment plan" },
  ];
  return <>
    <section className="metric-grid">
      {cards.map((card) => {
        const Icon = card.icon;
        return <article className="metric-card" key={card.label}><div className="metric-top"><span>{card.label}</span><span className={`metric-icon ${card.tone}`}><Icon size={17} /></span></div><strong className="metric-value">{loading && card.value === undefined ? "—" : (card.value ?? 0).toLocaleString()}</strong><span className="metric-caption">{card.caption}</span></article>;
      })}
    </section>
    <section className="insight-banner">
      <div className="insight-symbol"><Sparkles size={21} /></div>
      <div className="insight-copy"><span className="eyebrow">REALLOCATION FIRST</span><h2>{metrics?.reallocationOpportunities ?? 0} request{metrics?.reallocationOpportunities === 1 ? "" : "s"} may be fulfilled from campus surplus</h2><p>Protected minimum stock stays in place. Move what is available before recommending procurement.</p></div>
      <button className="button button-white" onClick={onOpenRequests}>Review requests <ArrowRight size={15} /></button>
    </section>
    <section className="content-grid overview-grid">
      <div className="panel request-panel">
        <div className="panel-heading"><div><span className="eyebrow">NEEDS ATTENTION</span><h2>Priority requests</h2></div><button className="text-button" onClick={onOpenRequests}>View all <ArrowRight size={14} /></button></div>
        <RequestTable requests={dashboard?.recentRequests ?? []} loading={loading} compact />
      </div>
      <div className="panel allocation-panel">
        <div className="panel-heading"><div><span className="eyebrow">HOW IT WORKS</span><h2>Allocate with confidence</h2></div><div className="round-icon"><CircleHelp size={16} /></div></div>
        <div className="flow-list">
          <button type="button" className="flow-step" onClick={onOpenInventory} aria-label="Track campus inventory">
            <span className="flow-number">01</span><div><strong>Track</strong><p>See stock and protected minimums by location.</p></div><ArrowDownLeft size={16} />
          </button>
          <button type="button" className="flow-step" onClick={onOpenRequests} aria-label="Review requests for reallocation">
            <span className="flow-number">02</span><div><strong>Reallocate</strong><p>Find excess stock elsewhere on campus.</p></div><ArrowRight size={16} />
          </button>
          <button type="button" className="flow-step" onClick={onOpenRequests} aria-label="Review requests and procurement needs">
            <span className="flow-number">03</span><div><strong>Reorder</strong><p>Record procurement only for the remaining gap.</p></div><ArrowUpRight size={16} />
          </button>
        </div>
        <button className="button button-secondary button-wide" onClick={onOpenInventory}>Explore campus inventory <ArrowRight size={15} /></button>
      </div>
    </section>
    <div className="info-strip"><Shield size={16} /><span>Every approved transfer is atomic: source stock, destination stock, request fulfillment, and ledger entries are committed together.</span></div>
  </>;
}

function RequestTable({ requests, loading, compact = false, onWithdraw, canWithdraw }: {
  requests: ResourceRequest[];
  loading: boolean;
  compact?: boolean;
  onWithdraw?: (request: ResourceRequest) => void;
  canWithdraw?: (request: ResourceRequest) => boolean;
}) {
  if (loading && requests.length === 0) return <div className="empty-state"><div className="loading-dot" /> Loading request queue...</div>;
  if (requests.length === 0) return <div className="empty-state"><span className="empty-icon"><Check size={18} /></span><strong>All caught up</strong><span>No requests in this section.</span></div>;
  return <div className={`table-scroll request-table${compact ? " compact" : ""}`}><table><thead><tr><th>RESOURCE / REQUESTER</th><th>DEPARTMENT</th><th>QUANTITY</th><th>PRIORITY</th><th>DUE DATE</th>{!compact && <th>STATUS</th>}{canWithdraw && <th>ACTION</th>}</tr></thead><tbody>{requests.map((request) => <tr key={request.request_id}>
    <td><div className="table-primary">{request.resource_name}</div><div className="table-secondary">{request.requester_name} · {request.purpose}</div>{request.status === "CANCELLED" && <div className="request-withdrawn-by">Withdrawn by {request.withdrawn_by_name ?? "account no longer available"}</div>}</td>
    <td>{request.department_name}</td><td><strong>{["PENDING", "PARTIALLY_FULFILLED"].includes(request.status) ? request.quantity - request.fulfilled_quantity : request.quantity}</strong> <span className="unit-text">{request.unit} {["PENDING", "PARTIALLY_FULFILLED"].includes(request.status) ? "left" : "requested"}</span>{request.fulfilled_quantity > 0 && <div className="table-secondary">{request.fulfilled_quantity} fulfilled</div>}</td>
    <td><Badge kind={`priority-${request.priority.toLowerCase()}`}><span className="badge-dot" />{request.priority}</Badge></td>
    <td className="date-cell">{formatDate(request.needed_by)}</td>{!compact && <td><Badge kind={request.status === "PARTIALLY_FULFILLED" ? "status-progress" : request.status === "CANCELLED" ? "status-cancelled" : "status-open"}>{request.status === "CANCELLED" ? "WITHDRAWN" : request.status.replaceAll("_", " ")}</Badge></td>}
    {canWithdraw && <td>{canWithdraw(request) && request.status === "PENDING" && request.fulfilled_quantity === 0 && <button className="button button-secondary button-small request-withdraw-button" onClick={() => onWithdraw?.(request)}>Withdraw</button>}</td>}
  </tr>)}</tbody></table></div>;
}

function Inventory({ resources, query, setQuery, loading, user, busyKey, onPerform }: {
  resources: Resource[];
  query: string;
  setQuery: (value: string) => void;
  loading: boolean;
  user: SessionUser;
  busyKey: string;
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
}) {
  return <section className="panel inventory-panel">
    <div className="inventory-toolbar"><div><span className="eyebrow">CAMPUS-WIDE STOCK</span><h2>Resource directory <span className="count-pill">{resources.length}</span></h2></div><label className="search-box"><Search size={16} /><input aria-label="Search resources" placeholder="Search name, SKU, category..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>⌘ K</kbd></label></div>
    {loading && resources.length === 0 ? <div className="empty-state"><div className="loading-dot" /> Loading inventory...</div> : resources.length === 0 ? <div className="empty-state"><Package size={20} /><strong>No resources found</strong><span>Try another search or seed the database.</span></div> : <div className="resource-grid">{resources.map((resource, index) => <article className="resource-card" key={resource.resource_id}>
      <div className="resource-card-top"><div className={`resource-symbol symbol-${index % 4}`}><Package size={19} /></div><Badge kind={resource.is_low_stock ? "priority-high" : "status-healthy"}><span className="badge-dot" />{resource.is_low_stock ? "LOW STOCK" : "HEALTHY"}</Badge></div>
      <div className="resource-category">{resource.category_name} <span>/</span> {resource.sku}</div><h3>{resource.resource_name}</h3>
      <div className="resource-type-label">{resource.resource_type === "CONSUMABLE" ? "CONSUMABLE · RECORD USE" : "REUSABLE · CHECK OUT & RETURN"}</div>
      <div className="stock-summary"><div><strong>{resource.total_on_hand}</strong><span>units total</span></div><div><strong>{resource.reallocatable}</strong><span>reallocatable</span></div><div><strong>{resource.campus_minimum}</strong><span>protected</span></div></div>
      {user.role === "ADMIN" && resource.total_checked_out > 0 && <div className="checked-out-summary">{resource.total_checked_out} {resource.unit} currently checked out across campus</div>}
      <div className="location-list"><div className="location-label">LOCATION BREAKDOWN</div>{resource.locations.filter(Boolean).map((location) => <div className="location-entry" key={location.locationId}>
        <div className="location-row"><span><span className="location-dot" />{location.locationName}</span><span className="location-stock">{location.onHand} <small>{user.role === "ADMIN" ? `/ out ${location.checkedOut}` : `/ yours ${location.myCheckedOut}`} / min {location.minimumRequired}</small></span></div>
        <LocationUsageActions resource={resource} location={location} user={user} busyKey={busyKey} onPerform={onPerform} />
      </div>)}</div>
    </article>)}</div>}
  </section>;
}

function LocationUsageActions({ resource, location, user, busyKey, onPerform }: {
  resource: Resource;
  location: ResourceLocation;
  user: SessionUser;
  busyKey: string;
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
}) {
  const [quantity, setQuantity] = useState("1");
  const canManage = user.role !== "ADMIN" &&
    user.departmentId !== null &&
    user.departmentId === location.departmentId &&
    (location.myAvailableAllocation > 0 || location.myCheckedOut > 0);
  if (!canManage) return null;

  const available = Math.max(0, location.onHand - location.checkedOut - location.minimumRequired);
  const personalAvailable = Math.min(available, location.myAvailableAllocation);
  const reusable = resource.resource_type === "REUSABLE";
  const maximum = reusable ? Math.max(personalAvailable, location.myCheckedOut) : personalAvailable;
  const canReturn = reusable && location.myCheckedOut > 0;
  const canCheckout = reusable && personalAvailable > 0;
  const canConsume = !reusable && personalAvailable > 0;

  async function submitUsage(selectedAction: "CHECKOUT" | "RETURN" | "CONSUME") {
    const success = selectedAction === "CHECKOUT"
      ? "Resource checked out."
      : selectedAction === "RETURN"
        ? "Resource return recorded."
        : "Resource use recorded.";
    const key = `usage-${selectedAction}-${resource.resource_id}-${location.locationId}`;
    const completed = await onPerform(
      key,
      () => api("/api/usage", {
        method: "POST",
        body: JSON.stringify({
          resourceId: resource.resource_id,
          locationId: location.locationId,
          quantity,
          action: selectedAction,
        }),
      }),
      success,
    );
    if (completed) setQuantity("1");
  }

  const actionBusy = ["CHECKOUT", "RETURN", "CONSUME"].some(
    (item) => busyKey === `usage-${item}-${resource.resource_id}-${location.locationId}`,
  );
  return <div className="usage-actions">
    {(canReturn || canCheckout || canConsume) && <input
      aria-label={`Quantity for ${resource.resource_name} at ${location.locationName}`}
      type="number"
      min="1"
      max={maximum}
      value={quantity}
      onChange={(event) => setQuantity(event.target.value)}
    />}
    {reusable && canReturn && <button className="text-button" disabled={actionBusy || Number(quantity) < 1 || Number(quantity) > location.myCheckedOut} onClick={() => void submitUsage("RETURN")}>Return</button>}
    {reusable && canCheckout && <button className="text-button" disabled={actionBusy || Number(quantity) < 1 || Number(quantity) > personalAvailable} onClick={() => void submitUsage("CHECKOUT")}>Check out</button>}
    {!reusable && canConsume && <button className="text-button" disabled={actionBusy || Number(quantity) < 1 || Number(quantity) > personalAvailable} onClick={() => void submitUsage("CONSUME")}>Record use</button>}
    {!canReturn && !canCheckout && !canConsume && <span className="usage-unavailable">No available units above the protected minimum</span>}
  </div>;
}

function RequestsPanel({ requests, resources, user, loading, expandedRequest, recommendations, busyKey, onLoadRecommendation, onPerform }: {
  requests: ResourceRequest[]; resources: Resource[]; user: SessionUser; loading: boolean;
  expandedRequest: string | null; recommendations: Record<string, Recommendation>; busyKey: string;
  onLoadRecommendation: (id: string, clearNotice?: boolean) => Promise<void>;
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
}) {
  const [resourceId, setResourceId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("MEDIUM");
  const [neededBy, setNeededBy] = useState("");
  const [purpose, setPurpose] = useState("");
  const [showForm, setShowForm] = useState(false);
  const isAdmin = user.role === "ADMIN";
  const openRequests = requests.filter((request) => ["PENDING", "PARTIALLY_FULFILLED"].includes(request.status));
  const fulfilledRequests = requests.filter((request) => request.status === "FULFILLED");
  const withdrawnRequests = requests.filter((request) => request.status === "CANCELLED");

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await onPerform("request", () => api("/api/requests", {
      method: "POST",
      body: JSON.stringify({ resourceId, quantity, priority, neededBy, purpose }),
    }), "Resource request submitted.");
    if (ok) { setPurpose(""); setQuantity("1"); setShowForm(false); }
  }

  function withdrawRequest(request: ResourceRequest) {
    const owner = isAdmin ? "this" : "your";
    if (window.confirm(`Withdraw ${owner} unfulfilled request for ${request.resource_name}? It will remain in request history.`)) {
      void onPerform(
        `withdraw-${request.request_id}`,
        () => api(`/api/requests/${request.request_id}`, { method: "PATCH" }),
        "Request withdrawn.",
      );
    }
  }

  async function approveTransfer(requestId: string, sourceLocationId: string, quantity: number) {
    const approved = await onPerform(
      `transfer-${requestId}`,
      () => api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ requestId, sourceLocationId, quantity }),
      }),
      "Transfer approved and recorded atomically.",
    );
    if (approved) await onLoadRecommendation(requestId, false);
  }

  async function recordProcurement(requestId: string, quantity: number, resourceName: string, unit: string) {
    const recorded = await onPerform(
      `procurement-${requestId}`,
      () => api("/api/procurement", {
        method: "POST",
        body: JSON.stringify({
          requestId,
          quantity,
          justification: `No campus surplus available for ${quantity} ${unit} of ${resourceName}.`,
        }),
      }),
      "Procurement recommendation recorded.",
    );
    if (recorded) await onLoadRecommendation(requestId, false);
  }

  return <>
    <section className="panel requests-panel">
      <div className="panel-heading"><div><span className="eyebrow">{isAdmin ? "FULFILLMENT QUEUE" : "YOUR REQUESTS"}</span><h2>{isAdmin ? "Pending requests" : "Open resource requests"} <span className="count-pill">{openRequests.length}</span></h2>{isAdmin && <p>Withdraw eligible requests or check reallocation for outstanding quantities.</p>}</div>
        {user.role !== "ADMIN" && user.departmentId && <button className="button button-primary" onClick={() => setShowForm(!showForm)}><Plus size={16} /> New request</button>}
      </div>
      {showForm && <form className="request-form form-grid" onSubmit={(event) => void createRequest(event)}>
        <label>Resource<select value={resourceId} onChange={(event) => setResourceId(event.target.value)} required><option value="">Choose a resource</option>{resources.map((resource) => <option key={resource.resource_id} value={resource.resource_id}>{resource.resource_name} · {resource.total_on_hand} on campus</option>)}</select></label>
        <label>Quantity<input type="number" min="1" max="100000" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
        <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></label>
        <label>Needed by<input type="date" min={getLocalDateString()} value={neededBy} onChange={(event) => setNeededBy(event.target.value)} /></label>
        <label className="form-span">Purpose<input minLength={8} maxLength={500} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Explain what this resource will support..." required /></label>
        <div className="form-span form-actions"><span>Requests are prioritized using urgency and submission time.</span><button className="button button-primary" disabled={busyKey === "request"} type="submit">{busyKey === "request" ? "Submitting..." : "Submit request"} <ArrowRight size={15} /></button></div>
      </form>}
      {loading && requests.length === 0 ? <div className="empty-state">Loading requests...</div> : <RequestTable
        requests={openRequests}
        loading={loading}
        canWithdraw={isAdmin ? undefined : (request) => String(request.requested_by) === user.userId}
        onWithdraw={withdrawRequest}
      />}
    </section>
    {isAdmin && openRequests.map((request) => {
      const requestId = String(request.request_id);
      const recommendation = recommendations[requestId];
      const isExpanded = expandedRequest === requestId;
      return <section className={`panel allocation-request ${isExpanded ? "expanded" : ""}`} key={requestId}>
        <div className="allocation-request-header">
          <div className="allocation-request-title"><span className="recommendation-icon"><Sparkles size={17} /></span><div><strong>{request.resource_name}</strong><span>{request.department_name} needs {request.quantity - request.fulfilled_quantity} {request.unit} · {request.priority.toLowerCase()} priority</span></div></div>
          <div className="request-header-actions">
            {request.status === "PENDING" && request.fulfilled_quantity === 0 &&
              <button className="button button-secondary button-small request-withdraw-button" disabled={busyKey === `withdraw-${requestId}`} onClick={() => withdrawRequest(request)}>Withdraw</button>}
            <button className="button button-secondary" onClick={() => onLoadRecommendation(requestId)} disabled={busyKey === `recommendation-${requestId}`}>
              <Sparkles size={15} /> {busyKey === `recommendation-${requestId}` ? "Checking..." : "Check reallocation"}
            </button>
          </div>
        </div>
        {isExpanded && recommendation && <div className="recommendation-body">
          <div className="recommendation-destination"><ArrowDownLeft size={15} /><span>Moving stock for</span><strong>{recommendation.request.requesterName}</strong><span>into</span><strong>{recommendation.request.destinationLocationName}</strong></div>
          {recommendation.options.length > 0 ? recommendation.options.map((option) => <div className="recommendation-row" key={option.locationId}>
            <div className="recommendation-source"><span className="source-icon"><Building2 size={16} /></span><div><strong>{option.locationName}</strong><span>{option.onHand} on hand · {option.checkedOut} checked out · {option.minimumRequired} protected minimum · {option.availableSurplus} available surplus</span></div></div>
            <div className="recommendation-action"><span className="quantity-chip">{option.recommendedQuantity} {recommendation.request.unit}</span>{user.role === "ADMIN" && <button className="button button-primary button-small" disabled={busyKey === `transfer-${requestId}`} onClick={() => void approveTransfer(requestId, option.locationId, option.recommendedQuantity)}>Approve transfer <ArrowRight size={13} /></button>}</div>
          </div>) : <div className="empty-surplus"><AlertTriangle size={16} /> No stock can be moved without dropping below campus minimums.</div>}
          {recommendation.procurementQuantity > 0 && <div className="procurement-note"><div><Truck size={16} /><span>Procurement fallback: <strong>{recommendation.procurementQuantity} {recommendation.request.unit}</strong> still needed after available surplus.</span></div>{user.role === "ADMIN" && <button className="text-button" disabled={busyKey === `procurement-${requestId}`} onClick={() => void recordProcurement(requestId, recommendation.procurementQuantity, recommendation.request.resourceName, recommendation.request.unit)}>Record recommendation <ArrowRight size={14} /></button>}</div>}
          {recommendation.procurementQuantity === 0 && recommendation.options.length > 0 && <div className="procurement-complete"><Check size={15} /> Campus surplus can cover the full outstanding quantity.</div>}
        </div>}
      </section>;
    })}
    <>
      <section className="panel requests-panel">
        <div className="panel-heading"><div><span className="eyebrow">{isAdmin ? "ADMIN HISTORY" : "YOUR HISTORY"}</span><h2>Fulfilled requests <span className="count-pill">{fulfilledRequests.length}</span></h2></div></div>
        <RequestTable requests={fulfilledRequests} loading={loading} />
      </section>
      <section className="panel requests-panel">
        <div className="panel-heading"><div><span className="eyebrow">{isAdmin ? "ADMIN HISTORY" : "YOUR HISTORY"}</span><h2>Withdrawn requests <span className="count-pill">{withdrawnRequests.length}</span></h2></div></div>
        <RequestTable requests={withdrawnRequests} loading={loading} />
      </section>
    </>
    {openRequests.length === 0 && !loading && !isAdmin && <div className="info-strip"><Clock3 size={16} /><span>Submit a request to see its status and fulfillment updates here.</span></div>}
  </>;
}

function ReportsPanel({ reports, summary, resources, user, busyKey, onPerform }: {
  reports: Report[]; resources: Resource[]; busyKey: string;
  user: SessionUser;
  summary: ReportSummary[];
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
}) {
  const [resourceId, setResourceId] = useState("");
  const [title, setTitle] = useState("");
  const [condition, setCondition] = useState("FAIR");
  const [severity, setSeverity] = useState("LOW");
  const [notes, setNotes] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await onPerform("report", () => api("/api/reports", {
      method: "POST",
      body: JSON.stringify({ resourceId, title, condition, severity, notes, tags: [] }),
    }), "Condition report saved to the maintenance record.");
    if (ok) { setTitle(""); setNotes(""); }
  }

  async function updateReportStatus(report: Report, status: "IN_PROGRESS" | "RESOLVED") {
    const successMessage = status === "IN_PROGRESS"
      ? "Report marked as in progress."
      : "Report marked as fixed.";
    await onPerform(
      `report-status-${report.reportId}`,
      () => api(`/api/reports?reportId=${encodeURIComponent(report.reportId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
      successMessage,
    );
  }

  return <div className="content-grid report-grid">
    {user.role !== "ADMIN" && <section className="panel report-form-panel"><div className="panel-heading"><div><span className="eyebrow">MONGODB MAINTENANCE RECORD</span><h2>Log a condition report</h2></div><span className="round-icon"><FileText size={16} /></span></div>
      <p className="panel-description">Record condition observations and maintenance details for a campus resource.</p>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>Resource<select value={resourceId} onChange={(event) => setResourceId(event.target.value)} required><option value="">Choose an item</option>{resources.map((resource) => <option key={resource.resource_id} value={resource.resource_id}>{resource.resource_name} ({resource.sku})</option>)}</select></label>
        <label>Report title<input minLength={4} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Missing sensor components" required /></label>
        <div className="form-grid"><label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option>GOOD</option><option>FAIR</option><option>POOR</option><option>DAMAGED</option></select></label><label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label></div>
        <label>Notes<textarea minLength={10} maxLength={2000} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe the condition, symptoms, or maintenance action needed..." required /></label>
        <button className="button button-primary button-wide" disabled={busyKey === "report"} type="submit">{busyKey === "report" ? "Saving report..." : "Save condition report"} <ArrowRight size={15} /></button>
      </form>
      <div className="report-note"><Boxes size={15} /><span>Report details and reporter information are stored in MongoDB.</span></div>
    </section>}
    <section className={`panel reports-list-panel${user.role === "ADMIN" ? " admin-reports-panel" : ""}`}><div className="panel-heading"><div><span className="eyebrow">{user.role === "ADMIN" ? "ADMIN REVIEW QUEUE" : "YOUR REPORT HISTORY"}</span><h2>{user.role === "ADMIN" ? "Reports needing attention" : "Your maintenance records"} <span className="count-pill">{reports.length}</span></h2></div><div className="round-icon"><Wrench size={16} /></div></div>
      {reports.length === 0 ? <div className="empty-state"><Wrench size={19} /><strong>{user.role === "ADMIN" ? "No reports need attention" : "No condition reports yet"}</strong><span>{user.role === "ADMIN" ? "New and in-progress reports will appear here." : "Submit a report to see its status and history here."}</span></div> : <div className="report-list">{reports.map((report) => <article className="report-card" key={report.reportId}><div className="report-card-top"><Badge kind={report.severity === "CRITICAL" || report.severity === "HIGH" ? "priority-high" : "priority-low"}><span className="badge-dot" />{report.severity}</Badge><span className="report-date">{formatDate(report.createdAt)}</span></div><h3>{report.title}</h3><p className="report-resource">{report.resourceName} <span>·</span> {report.condition.toLowerCase()} condition</p><p className="report-notes">{report.notes}</p><div className="report-author"><span className="mini-avatar">{report.reportedBy.name[0]}</span>Reported by {report.reportedBy.name}<Badge kind={report.status === "RESOLVED" ? "status-healthy" : report.status === "IN_PROGRESS" ? "status-progress" : "status-open"}>{report.status === "RESOLVED" ? "FIXED" : report.status.replaceAll("_", " ")}</Badge></div>{report.statusUpdatedBy && <div className="report-status-update">Updated by <strong>{report.statusUpdatedBy.name}</strong></div>}{user.role === "ADMIN" && <div className="report-actions">{report.status === "OPEN" && <button className="button button-secondary button-small" disabled={busyKey === `report-status-${report.reportId}`} onClick={() => void updateReportStatus(report, "IN_PROGRESS")}>Mark in progress</button>}{report.status === "IN_PROGRESS" && <button className="button button-primary button-small" disabled={busyKey === `report-status-${report.reportId}`} onClick={() => void updateReportStatus(report, "RESOLVED")}>Mark fixed</button>}</div>}</article>)}</div>}
      <div className="report-summary"><Activity size={15} /><span>Report counts by severity and status: {summary.length ? summary.map((item) => `${item.severity} ${item.status.toLowerCase()}: ${item.count}`).join(" · ") : "No report groups yet."}</span></div>
    </section>
  </div>;
}

function CheckedOutPanel() {
  const [checkouts, setCheckouts] = useState<CheckoutRecord[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedCheckout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await api<{ checkouts: CheckoutRecord[]; unassigned: UnassignedCheckout[] }>("/api/usage");
      setCheckouts(result.checkouts);
      setUnassigned(result.unassigned);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load active checkouts.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadCheckouts = async () => { await refresh(); };
    void loadCheckouts();
  }, [refresh]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [refresh]);

  const totalOutstanding = checkouts.reduce((total, checkout) => total + checkout.quantity, 0)
    + unassigned.reduce((total, checkout) => total + checkout.quantity, 0);

  return <div className="content-grid">
    <section className="panel requests-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">ACTIVE CHECKOUTS</span><h2>Resources currently held <span className="count-pill">{totalOutstanding}</span></h2></div>
        <button className="button button-secondary button-small" onClick={() => void refresh()} disabled={loading}><Activity size={14} /> {loading ? "Loading" : "Refresh"}</button>
      </div>
      <p className="panel-description">These quantities are still out of inventory and are not available for reallocation.</p>
      {error && <div className="alert alert-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      {loading ? <div className="empty-state">Loading active checkouts...</div> : checkouts.length === 0 && unassigned.length === 0 ? <div className="empty-state"><PackageCheck size={19} /><strong>No resources are currently checked out</strong><span>New checkouts will appear here with the holder and department.</span></div> : <>
        {checkouts.length > 0 && <div className="table-scroll request-table"><table><thead><tr><th>RESOURCE</th><th>HOLDER</th><th>LOCATION</th><th>QUANTITY OUT</th></tr></thead><tbody>
          {checkouts.map((checkout, index) => <tr key={`${checkout.resourceId}-${checkout.locationName}-${checkout.holderName}-${index}`}>
            <td><div className="table-primary">{checkout.resourceName}</div><div className="table-secondary">{checkout.unit}</div></td>
            <td><div className="table-primary">{checkout.holderName}</div><div className="table-secondary">{checkout.holderDepartment}</div></td>
            <td><div className="table-primary">{checkout.locationName}</div><div className="table-secondary">{checkout.locationDepartment}</div></td>
            <td><strong>{checkout.quantity} {checkout.unit}</strong></td>
          </tr>)}
        </tbody></table></div>}
        {unassigned.length > 0 && <div className="info-strip"><AlertTriangle size={16} /><span>Some inventory is marked as checked out but has no matching holder record. These quantities are shown separately below rather than attributed to a person.</span></div>}
        {unassigned.length > 0 && <div className="table-scroll request-table"><table><thead><tr><th>RESOURCE</th><th>LOCATION</th><th>UNASSIGNED OUT</th></tr></thead><tbody>
          {unassigned.map((checkout, index) => <tr key={`${checkout.resourceName}-${checkout.locationName}-${index}`}>
            <td><div className="table-primary">{checkout.resourceName}</div><div className="table-secondary">{checkout.unit}</div></td>
            <td><div className="table-primary">{checkout.locationName}</div><div className="table-secondary">{checkout.locationDepartment}</div></td>
            <td><strong>{checkout.quantity} {checkout.unit}</strong></td>
          </tr>)}
        </tbody></table></div>}
      </>}
    </section>
  </div>;
}

function ProcurementPanel({ busyKey, onPerform, onOpenRequest }: {
  busyKey: string;
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
  onOpenRequest: (requestId: string) => void;
}) {
  const [procurements, setProcurements] = useState<ProcurementRecord[]>([]);
  const [locations, setLocations] = useState<ProcurementLocation[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<Record<string, string>>({});
  const [suppliers, setSuppliers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await api<{ procurements: ProcurementRecord[]; locations: ProcurementLocation[] }>("/api/procurement");
      setProcurements(result.procurements);
      setLocations(result.locations);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load procurement records.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadProcurements = async () => { await refresh(); };
    void loadProcurements();
  }, [refresh]);

  async function updateProcurement(procurement: ProcurementRecord, action: "ORDER" | "RECEIVE") {
    const locationId = selectedLocations[procurement.procurementId]
      ?? procurement.preferredLocationId
      ?? locations[0]?.locationId;
    if (action === "RECEIVE" && !locationId) {
      setError("Add an active location before receiving procurement.");
      return;
    }
    const updated = await onPerform(
      `procurement-${procurement.procurementId}`,
      () => api(`/api/procurement?procurementId=${encodeURIComponent(procurement.procurementId)}`, {
        method: "PATCH",
        body: JSON.stringify(action === "ORDER"
          ? { action }
          : { action, locationId, supplier: suppliers[procurement.procurementId] ?? procurement.supplier }),
      }),
      action === "ORDER" ? "Procurement marked as ordered." : "Procurement received and inventory updated.",
    );
    if (updated) await refresh(false);
  }

  const statusKind = (status: ProcurementRecord["status"]) => ({
    RECOMMENDED: "status-open",
    ORDERED: "status-progress",
    RECEIVED: "status-healthy",
    CANCELLED: "status-cancelled",
  })[status];

  return <div className="content-grid procurement-grid">
    <section className="panel procurement-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">PROCUREMENT TRACKER</span><h2>Recorded procurements <span className="count-pill">{procurements.length}</span></h2></div>
        <button className="button button-secondary button-small" onClick={() => void refresh()} disabled={loading}><Activity size={14} /> {loading ? "Loading" : "Refresh"}</button>
      </div>
      <p className="panel-description">Mark recommendations as ordered, then receive each delivery into a selected location. Received units are added to stock once and can be used in the normal reallocation flow.</p>
      {error && <div className="alert alert-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      {loading ? <div className="empty-state">Loading procurement records...</div> : procurements.length === 0 ? <div className="empty-state"><Truck size={19} /><strong>No procurement records yet</strong><span>Record a procurement fallback from an admin reallocation recommendation.</span></div> : <div className="table-scroll request-table procurement-table"><table>
        <thead><tr><th>RESOURCE / REQUEST</th><th>QUANTITY</th><th>SUPPLIER / DESTINATION</th><th>STATUS</th><th>CREATED / ORDERED / RECEIVED</th><th>ACTION</th></tr></thead>
        <tbody>{procurements.map((procurement) => <tr key={procurement.procurementId}>
          <td><div className="table-primary">{procurement.resourceName}</div><div className="table-secondary">{procurement.requestId ? `Request #${procurement.requestId}` : "Request no longer available"} · {procurement.recommendedBy}</div><div className="table-secondary">{procurement.justification}</div></td>
          <td><strong>{procurement.quantity} {procurement.unit}</strong></td>
          <td>
            <div className="table-primary">{procurement.supplier || "Supplier not specified"}</div>
            {procurement.status === "ORDERED" && <>
              <select aria-label={`Receiving location for procurement ${procurement.procurementId}`} value={selectedLocations[procurement.procurementId] ?? procurement.preferredLocationId ?? locations[0]?.locationId ?? ""} onChange={(event) => setSelectedLocations((current) => ({ ...current, [procurement.procurementId]: event.target.value }))}>
                {locations.map((location) => <option key={location.locationId} value={location.locationId}>{location.name}{location.locationType === "STORE" ? " (Store)" : ""}</option>)}
              </select>
              <input aria-label={`Supplier for procurement ${procurement.procurementId}`} maxLength={160} placeholder="Supplier (optional)" value={suppliers[procurement.procurementId] ?? procurement.supplier} onChange={(event) => setSuppliers((current) => ({ ...current, [procurement.procurementId]: event.target.value }))} />
            </>}
            {procurement.status === "RECEIVED" && <div className="table-secondary">{procurement.receivedLocationName ?? "Destination unavailable"}</div>}
          </td>
          <td><Badge kind={statusKind(procurement.status)}><span className="badge-dot" />{procurement.status}</Badge></td>
          <td><div className="table-secondary">Created {formatDate(procurement.createdAt)}</div><div className="table-secondary">Ordered {formatDate(procurement.orderedAt)}</div><div className="table-secondary">Received {formatDate(procurement.receivedAt)}</div></td>
          <td>{procurement.status === "RECOMMENDED" && <button className="button button-secondary button-small" disabled={busyKey === `procurement-${procurement.procurementId}`} onClick={() => void updateProcurement(procurement, "ORDER")}>Mark ordered</button>}
            {procurement.status === "ORDERED" && <button className="button button-primary button-small" disabled={busyKey === `procurement-${procurement.procurementId}` || locations.length === 0} onClick={() => void updateProcurement(procurement, "RECEIVE")}>Mark received</button>}
            {procurement.status === "RECEIVED" && procurement.requestId && ["PENDING", "PARTIALLY_FULFILLED"].includes(procurement.requestStatus ?? "") && <button className="button button-secondary button-small" onClick={() => { if (procurement.requestId) onOpenRequest(procurement.requestId); }}>Fulfill request</button>}
            {(procurement.status === "CANCELLED" || procurement.status === "RECEIVED" && (!procurement.requestId || !["PENDING", "PARTIALLY_FULFILLED"].includes(procurement.requestStatus ?? ""))) && <span className="unit-text">—</span>}
          </td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}

function AccountsPanel({ accounts, departments, loading, busyKey, onPerform, onRefresh }: {
  accounts: ManagedAccount[];
  departments: Department[];
  loading: boolean;
  busyKey: string;
  onPerform: <T>(key: string, action: () => Promise<T>, success: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"STAFF" | "STUDENT">("STAFF");
  const [departmentId, setDepartmentId] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const filteredAccounts = accounts.filter((account) =>
    account.fullName.toLocaleLowerCase().includes(nameSearch.trim().toLocaleLowerCase()),
  );

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await onPerform("account", () => api("/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify({ fullName, email, password, role, departmentId }),
    }), "User account created.");
    if (created) {
      setFullName("");
      setEmail("");
      setPassword("");
      await onRefresh();
    }
  }

  async function setAccountActive(account: ManagedAccount) {
    const nextIsActive = !account.isActive;
    if (!window.confirm(`${nextIsActive ? "Reactivate" : "Deactivate"} ${account.fullName}'s account? ${nextIsActive ? "They will be able to sign in again." : "They will no longer be able to sign in; their history will be preserved."}`)) {
      return;
    }

    const updated = await onPerform(
      `account-status-${account.userId}`,
      () => api("/api/admin/accounts", {
        method: "PATCH",
        body: JSON.stringify({ userId: account.userId, isActive: nextIsActive }),
      }),
      nextIsActive ? "User account reactivated." : "User account deactivated.",
    );
    if (updated) await onRefresh();
  }

  return <div className="content-grid account-grid">
    <section className="panel account-form-panel">
      <div className="panel-heading"><div><span className="eyebrow">ADMINISTRATION</span><h2>Create a staff or student login</h2></div><span className="round-icon"><UserRoundPlus size={16} /></span></div>
      <p className="panel-description">Choose the account role and department. Share the temporary password securely with the new user.</p>
      <form className="form-stack" onSubmit={(event) => void createAccount(event)}>
        <label>Full name<input autoComplete="name" minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
        <label>Login email<input autoComplete="off" type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@campus.edu" required /></label>
        <label>Temporary password<input autoComplete="new-password" type="password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /><span className="field-hint">Use at least 12 characters. The password is stored as a secure hash.</span></label>
        <div className="form-grid account-selects">
          <label>Role<select value={role} onChange={(event) => setRole(event.target.value as "STAFF" | "STUDENT")}><option value="STAFF">Staff</option><option value="STUDENT">Student</option></select></label>
          <label>Department<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required><option value="">Choose a department</option>{departments.map((department) => <option key={department.departmentId} value={department.departmentId}>{department.name}</option>)}</select></label>
        </div>
        <button className="button button-primary button-wide" disabled={busyKey === "account" || departments.length === 0} type="submit">{busyKey === "account" ? "Creating account..." : "Create account"} <ArrowRight size={15} /></button>
        {departments.length === 0 && !loading && <p className="form-error">No departments are configured. Add departments to the database before creating accounts.</p>}
      </form>
    </section>
    <section className="panel accounts-list-panel">
      <div className="panel-heading"><div><span className="eyebrow">CAMPUS USERS</span><h2>Staff and students <span className="count-pill">{filteredAccounts.length}</span></h2></div><div className="round-icon"><Users size={16} /></div></div>
      <label className="requester-search account-search"><Search size={16} /><input aria-label="Search staff and students by name" placeholder="Search by name, e.g. Demo Staff 03..." value={nameSearch} onChange={(event) => setNameSearch(event.target.value)} /></label>
      {loading ? <div className="empty-state"><div className="loading-dot" /> Loading accounts...</div> : accounts.length === 0 ? <div className="empty-state"><Users size={19} /><strong>No staff or student accounts</strong><span>Create the first account using the form.</span></div> : filteredAccounts.length === 0 ? <div className="empty-state"><Users size={19} /><strong>No matching names</strong><span>Try another name.</span></div> : <div className="account-list">{filteredAccounts.map((account) => <article className="account-row" key={account.userId}>
        <div className="avatar">{account.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
        <div className="account-info"><strong>{account.fullName}</strong><span>{account.email}</span><small>{account.departmentName}</small></div>
        <Badge kind={account.role === "STAFF" ? "status-progress" : "status-open"}>{account.role}</Badge>
        {!account.isActive && <Badge kind="priority-high">INACTIVE</Badge>}
        <button
          className="button button-secondary button-small"
          disabled={busyKey === `account-status-${account.userId}`}
          onClick={() => void setAccountActive(account)}
          type="button"
        >
          {busyKey === `account-status-${account.userId}` ? "Updating..." : account.isActive ? "Deactivate" : "Reactivate"}
        </button>
      </article>)}</div>}
    </section>
  </div>;
}
