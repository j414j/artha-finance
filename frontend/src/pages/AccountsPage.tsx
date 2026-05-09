import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  archiveAccount,
  createAccount,
  getAccounts,
  updateAccount,
} from "../api/accounts";
import { ApiError } from "../api/client";
import AccountDrilldown from "../components/AccountDrilldown";
import Button from "../components/Button";
import Input from "../components/Input";
import ProgressBar from "../components/ProgressBar";
import Select from "../components/Select";
import Tag from "../components/Tag";
import type {
  Account,
  AccountGroup,
  AccountPayload,
  AccountsResponse,
  AccountType,
} from "../types/account";
import {
  formatDateDisplay,
  formatMoney,
  paiseToInput,
  parseMoneyInput,
} from "../utils/format";

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: "savings", label: "Savings" },
  { value: "current", label: "Current" },
  { value: "demat", label: "Demat" },
  { value: "mutual_fund", label: "Mutual Fund" },
  { value: "real_estate", label: "Real Estate" },
  { value: "other_asset", label: "Other Asset" },
  { value: "loan", label: "Loan" },
  { value: "credit_card", label: "Credit Card" },
  { value: "other_liability", label: "Other Liability" },
];

const GROUP_COLORS: Record<string, string> = {
  cash_bank: "var(--blue)",
  investments: "var(--purple)",
  real_estate: "var(--accent)",
  other_assets: "var(--green)",
  loans: "var(--red)",
  credit_cards: "#f06030",
  other_liabilities: "var(--red2)",
};

const EMPTY_RESPONSE: AccountsResponse = {
  summary: {
    total_assets_paise: 0,
    total_liabilities_paise: 0,
    net_worth_paise: 0,
  },
  asset_groups: [],
  liability_groups: [],
};

interface AccountFormState {
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  openingDate: string;
  inrValue: string;
  colorHex: string;
  notes: string;
}

function blankForm(): AccountFormState {
  return {
    name: "",
    type: "savings",
    currency: "INR",
    openingBalance: "",
    openingDate: todayInputDate(),
    inrValue: "",
    colorHex: "#3A7FFF",
    notes: "",
  };
}

export default function AccountsPage() {
  const [data, setData] = useState<AccountsResponse>(EMPTY_RESPONSE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [form, setForm] = useState<AccountFormState>(blankForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [drilldownAccount, setDrilldownAccount] = useState<Account | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getAccounts();
      setData(response);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Unable to load accounts",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const allAccounts = useMemo(
    () =>
      [...data.asset_groups, ...data.liability_groups].flatMap(
        (group) => group.accounts,
      ),
    [data],
  );

  const openCreateModal = () => {
    setEditingAccount(null);
    setForm(blankForm());
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (account: Account) => {
    setEditingAccount(account);
    setForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalance: paiseToInput(account.opening_balance_paise),
      openingDate: account.opening_date,
      inrValue: paiseToInput(account.inr_value_paise),
      colorHex: account.color_hex,
      notes: account.notes ?? "",
    });
    setFormError("");
    setActionMenuId(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingAccount(null);
    setFormError("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const payload = buildPayload(form);
      if (editingAccount) {
        await updateAccount(editingAccount.id, payload);
      } else {
        await createAccount(payload);
      }
      setModalOpen(false);
      setEditingAccount(null);
      await loadAccounts();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Unable to save account",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (account: Account) => {
    setActionMenuId(null);
    const confirmed = window.confirm(
      `Archive ${account.name}? It will be hidden from active views.`,
    );
    if (!confirmed) return;

    setArchivingId(account.id);
    setError("");
    try {
      await archiveAccount(account.id);
      await loadAccounts();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Unable to archive account",
      );
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 280px",
          gap: 1,
          minHeight: "100%",
          background: "var(--border)",
        }}
      >
        <div style={{ background: "var(--bg2)", minWidth: 0 }}>
          <SummaryStrip data={data} />

          {error && (
            <div style={noticeStyle("error")}>
              {error}
              <button
                onClick={() => void loadAccounts()}
                style={noticeButtonStyle}
              >
                Retry
              </button>
            </div>
          )}

          {loading ? (
            <EmptyPanel label="Loading accounts" />
          ) : allAccounts.length === 0 ? (
            <EmptyPanel label="No accounts yet" action={openCreateModal} />
          ) : (
            <>
              <AccountSideSection
                label="Assets"
                color="var(--green)"
                total={data.summary.total_assets_paise}
                groups={data.asset_groups}
                actionMenuId={actionMenuId}
                archivingId={archivingId}
                onToggleMenu={setActionMenuId}
                onEdit={openEditModal}
                onArchive={handleArchive}
                onSelect={setDrilldownAccount}
              />
              <AccountSideSection
                label="Liabilities"
                color="var(--red)"
                total={data.summary.total_liabilities_paise}
                groups={data.liability_groups}
                actionMenuId={actionMenuId}
                archivingId={archivingId}
                onToggleMenu={setActionMenuId}
                onEdit={openEditModal}
                onArchive={handleArchive}
                onSelect={setDrilldownAccount}
              />
            </>
          )}
        </div>

        <AccountSidebar
          data={data}
          loading={loading}
          onAddAccount={openCreateModal}
        />
      </div>

      {modalOpen && (
        <AccountModal
          form={form}
          editingAccount={editingAccount}
          error={formError}
          saving={saving}
          onClose={closeModal}
          onSubmit={handleSubmit}
          onChange={setForm}
        />
      )}

      {drilldownAccount && (
        <AccountDrilldown
          account={drilldownAccount}
          onClose={() => setDrilldownAccount(null)}
        />
      )}
    </div>
  );
}

function SummaryStrip({ data }: { data: AccountsResponse }) {
  const metrics = [
    {
      label: "Total Assets",
      value: data.summary.total_assets_paise,
      color: "var(--green)",
    },
    {
      label: "Total Liabilities",
      value: data.summary.total_liabilities_paise,
      color: "var(--red)",
    },
    {
      label: "Net Worth",
      value: data.summary.net_worth_paise,
      color: "var(--accent)",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 1,
        background: "var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          style={{ background: "var(--bg3)", padding: "10px 14px" }}
        >
          <MetricLabel>{metric.label}</MetricLabel>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 21,
              color: metric.color,
              marginTop: 6,
              lineHeight: 1.1,
            }}
          >
            {formatMoney(metric.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountSideSection({
  label,
  color,
  total,
  groups,
  actionMenuId,
  archivingId,
  onToggleMenu,
  onEdit,
  onArchive,
  onSelect,
}: {
  label: string;
  color: string;
  total: number;
  groups: AccountGroup[];
  actionMenuId: string | null;
  archivingId: string | null;
  onToggleMenu: (id: string | null) => void;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  onSelect: (account: Account) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <section>
      <GroupHeader label={label} total={total} color={color} />
      {groups.map((group, index) => (
        <div key={group.key}>
          <SubgroupHeader group={group} />
          <AccountTable
            group={group}
            showHeader={index === 0}
            actionMenuId={actionMenuId}
            archivingId={archivingId}
            onToggleMenu={onToggleMenu}
            onEdit={onEdit}
            onArchive={onArchive}
            onSelect={onSelect}
          />
        </div>
      ))}
    </section>
  );
}

function AccountTable({
  group,
  showHeader,
  actionMenuId,
  archivingId,
  onToggleMenu,
  onEdit,
  onArchive,
  onSelect,
}: {
  group: AccountGroup;
  showHeader: boolean;
  actionMenuId: string | null;
  archivingId: string | null;
  onToggleMenu: (id: string | null) => void;
  onEdit: (account: Account) => void;
  onArchive: (account: Account) => void;
  onSelect: (account: Account) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      {showHeader && (
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Currency</Th>
            <Th align="right">Balance</Th>
            <Th align="right">INR Value</Th>
            <Th>Last Updated</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
      )}
      <tbody>
        {group.accounts.map((account) => (
          <tr
            key={account.id}
            style={{ cursor: "pointer" }}
            onClick={() => onSelect(account)}
          >
            <Td>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: account.color_hex,
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {account.name}
                </span>
              </div>
            </Td>
            <Td>
              <Tag>{account.currency}</Tag>
            </Td>
            <Td
              align="right"
              mono
              color={
                account.side === "liability" ? "var(--red)" : "var(--text)"
              }
            >
              {formatMoney(account.balance_paise, account.currency)}
            </Td>
            <Td
              align="right"
              mono
              color={
                account.side === "liability" ? "var(--red)" : "var(--green)"
              }
            >
              {formatMoney(account.inr_value_paise)}
            </Td>
            <Td mono color="var(--text3)" size={10}>
              {formatDateDisplay(account.last_updated)}
            </Td>
            <Td align="right">
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  type="button"
                  title="Account actions"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMenu(actionMenuId === account.id ? null : account.id);
                  }}
                  style={actionButtonStyle}
                  disabled={archivingId === account.id}
                >
                  {archivingId === account.id ? "…" : "⋯"}
                </button>
                {actionMenuId === account.id && (
                  <div style={actionMenuStyle}>
                    <button
                      type="button"
                      style={menuItemStyle}
                      onClick={(e) => { e.stopPropagation(); onEdit(account); }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{ ...menuItemStyle, color: "var(--red)" }}
                      onClick={(e) => { e.stopPropagation(); onArchive(account); }}
                    >
                      Archive
                    </button>
                  </div>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AccountSidebar({
  data,
  loading,
  onAddAccount,
}: {
  data: AccountsResponse;
  loading: boolean;
  onAddAccount: () => void;
}) {
  const liabilityAccounts = data.liability_groups.flatMap(
    (group) => group.accounts,
  );

  return (
    <aside
      style={{
        background: "var(--bg2)",
        borderLeft: "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <SectionHeader>Asset Allocation</SectionHeader>
      <div
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <AllocationDonut groups={data.asset_groups} loading={loading} />
        <AllocationLegend
          groups={data.asset_groups}
          total={data.summary.total_assets_paise}
        />

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <SectionHeader compact>Liability Load</SectionHeader>
          {liabilityAccounts.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text3)", paddingTop: 4 }}>
              No active liabilities
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {liabilityAccounts.map((account) => {
                const pct =
                  data.summary.total_liabilities_paise === 0
                    ? 0
                    : (account.inr_value_paise /
                        data.summary.total_liabilities_paise) *
                      100;
                return (
                  <div key={account.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 3,
                        fontSize: 10,
                      }}
                    >
                      <span style={{ color: "var(--text2)" }}>
                        {account.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--red)",
                        }}
                      >
                        {formatMoney(account.inr_value_paise, "INR", true)}
                      </span>
                    </div>
                    <ProgressBar value={pct} variant="red" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Button onClick={onAddAccount} style={{ width: "100%", marginTop: 4 }}>
          + Add Account
        </Button>
      </div>
    </aside>
  );
}

function AllocationDonut({
  groups,
  loading,
}: {
  groups: AccountGroup[];
  loading: boolean;
}) {
  const total = groups.reduce(
    (sum, group) => sum + group.total_inr_value_paise,
    0,
  );
  const circumference = 2 * Math.PI * 60;
  let offset = 0;
  const largest = groups.reduce<AccountGroup | null>(
    (winner, group) =>
      !winner || group.total_inr_value_paise > winner.total_inr_value_paise
        ? group
        : winner,
    null,
  );
  const largestPct =
    total === 0 || !largest
      ? 0
      : Math.round((largest.total_inr_value_paise / total) * 100);

  return (
    <svg
      width="180"
      height="180"
      viewBox="0 0 180 180"
      style={{ display: "block", margin: "0 auto" }}
    >
      <circle
        cx="90"
        cy="90"
        r="60"
        fill="none"
        stroke="var(--border)"
        strokeWidth="28"
      />
      {!loading &&
        total > 0 &&
        groups.map((group) => {
          const dash = (group.total_inr_value_paise / total) * circumference;
          const circle = (
            <circle
              key={group.key}
              cx="90"
              cy="90"
              r="60"
              fill="none"
              stroke={GROUP_COLORS[group.key] ?? "var(--text3)"}
              strokeWidth="28"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 90 90)"
            />
          );
          offset += dash;
          return circle;
        })}
      <text
        x="90"
        y="88"
        textAnchor="middle"
        fontSize="18"
        fill="var(--text)"
        fontFamily="IBM Plex Mono"
      >
        {largestPct}%
      </text>
      <text
        x="90"
        y="103"
        textAnchor="middle"
        fontSize="9"
        fill="var(--text3)"
        fontFamily="IBM Plex Sans Condensed"
        letterSpacing="1"
      >
        {largest?.label.toUpperCase().slice(0, 11) ?? "ASSETS"}
      </text>
    </svg>
  );
}

function AllocationLegend({
  groups,
  total,
}: {
  groups: AccountGroup[];
  total: number;
}) {
  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 11, color: "var(--text3)" }}>
        No assets to allocate
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {groups.map((group) => {
        const pct =
          total === 0
            ? 0
            : Math.round((group.total_inr_value_paise / total) * 100);
        return (
          <div
            key={group.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              fontSize: 11,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: GROUP_COLORS[group.key] ?? "var(--text3)",
                }}
              />
              <span style={{ color: "var(--text2)" }}>{group.label}</span>
            </span>
            <span
              style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}
            >
              {pct}% · {formatMoney(group.total_inr_value_paise, "INR", true)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AccountModal({
  form,
  editingAccount,
  error,
  saving,
  onClose,
  onSubmit,
  onChange,
}: {
  form: AccountFormState;
  editingAccount: Account | null;
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (form: AccountFormState) => void;
}) {
  const update = <K extends keyof AccountFormState>(
    key: K,
    value: AccountFormState[K],
  ) => onChange({ ...form, [key]: value });
  const isInrAccount = form.currency.trim().toUpperCase() === "INR";

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <form
        style={modalStyle}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>{editingAccount ? "Edit Account" : "Add Account"}</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 160px",
              gap: 10,
            }}
          >
            <Input
              label="Name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              required
            />
            <Select
              label="Type"
              value={form.type}
              onChange={(event) =>
                update("type", event.target.value as AccountType)
              }
            >
              {ACCOUNT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr 1fr",
              gap: 10,
              marginTop: 10,
            }}
          >
            <Input
              label="Currency"
              value={form.currency}
              onChange={(event) =>
                update("currency", event.target.value.toUpperCase())
              }
              maxLength={3}
              required
            />
            <Input
              label="Opening Date"
              type="date"
              value={form.openingDate}
              onChange={(event) => update("openingDate", event.target.value)}
              required
            />
            <Input
              label="Colour"
              value={form.colorHex}
              onChange={(event) => update("colorHex", event.target.value)}
              maxLength={7}
              required
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isInrAccount ? "1fr" : "1fr 1fr",
              gap: 10,
              marginTop: 10,
            }}
          >
            <Input
              label="Opening Balance"
              value={form.openingBalance}
              onChange={(event) => update("openingBalance", event.target.value)}
              inputMode="decimal"
              required
            />
            {!isInrAccount && (
              <Input
                label="INR Value"
                value={form.inrValue}
                onChange={(event) => update("inrValue", event.target.value)}
                inputMode="decimal"
                required
              />
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </div>

          {error && (
            <div style={{ ...noticeStyle("error"), marginTop: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              style={{ flex: 1 }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} style={{ flex: 2 }}>
              {saving
                ? "Saving"
                : editingAccount
                  ? "Save Account"
                  : "Create Account"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function buildPayload(form: AccountFormState): AccountPayload {
  const name = form.name.trim();
  const currency = form.currency.trim().toUpperCase();
  const colorHex = form.colorHex.trim();
  const openingBalancePaise = parseMoneyInput(form.openingBalance);
  if (!name) throw new Error("Account name is required");
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Currency must be a 3-letter code");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.openingDate))
    throw new Error("Opening date is required");
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex))
    throw new Error("Color must be a hex value like #3A7FFF");

  return {
    name,
    type: form.type,
    currency,
    opening_balance_paise: openingBalancePaise,
    opening_date: form.openingDate,
    inr_value_paise:
      currency === "INR" ? openingBalancePaise : parseMoneyInput(form.inrValue),
    color_hex: colorHex,
    notes: form.notes.trim() ? form.notes.trim() : null,
  };
}

function GroupHeader({
  label,
  total,
  color,
}: {
  label: string;
  total: number;
  color: string;
}) {
  return (
    <div
      style={{
        ...groupHeaderStyle,
        marginTop: label === "Liabilities" ? 1 : 0,
      }}
    >
      <span>{label}</span>
      <span style={{ color }}>{formatMoney(total)}</span>
    </div>
  );
}

function SubgroupHeader({ group }: { group: AccountGroup }) {
  return (
    <div
      style={{
        ...groupHeaderStyle,
        background: "var(--bg2)",
        paddingLeft: 20,
        fontSize: 8,
        color: GROUP_COLORS[group.key] ?? "var(--text3)",
      }}
    >
      <span>{group.label}</span>
      <span style={{ color: "var(--text2)" }}>
        {formatMoney(group.total_inr_value_paise)}
      </span>
    </div>
  );
}

function SectionHeader({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-cond)",
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--text3)",
        borderBottom: compact ? "none" : "1px solid var(--border)",
        padding: compact ? "0 0 6px" : "6px 12px",
      }}
    >
      {children}
    </div>
  );
}

function MetricLabel({ children }: { children: string }) {
  return <div style={metricLabelStyle}>{children}</div>;
}

function EmptyPanel({ label, action }: { label: string; action?: () => void }) {
  return (
    <div
      style={{
        minHeight: 260,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        color: "var(--text3)",
        fontFamily: "var(--font-cond)",
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
      {action && <Button onClick={action}>+ Add Account</Button>}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: string;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        fontFamily: "var(--font-cond)",
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text3)",
        padding: "5px 10px",
        textAlign: align,
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
  color = "var(--text)",
  size = 12,
}: {
  children: ReactNode;
  align?: "left" | "right";
  mono?: boolean;
  color?: string;
  size?: number;
}) {
  return (
    <td
      style={{
        padding: "5px 10px",
        borderBottom: "1px solid var(--border)",
        fontSize: mono ? size : 12,
        whiteSpace: "nowrap",
        textAlign: align,
        fontFamily: mono ? "var(--font-mono)" : "var(--font)",
        color,
      }}
    >
      {children}
    </td>
  );
}

function noticeStyle(kind: "error" | "neutral"): CSSProperties {
  return {
    margin: 12,
    padding: "8px 10px",
    border: `1px solid ${kind === "error" ? "rgba(240,64,96,0.25)" : "var(--border2)"}`,
    background: kind === "error" ? "rgba(240,64,96,0.08)" : "var(--bg3)",
    color: kind === "error" ? "var(--red)" : "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  };
}

function todayInputDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const metricLabelStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: "var(--font-cond)",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
};

const groupHeaderStyle: CSSProperties = {
  background: "var(--bg3)",
  padding: "5px 12px",
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  color: "var(--text3)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderBottom: "1px solid var(--border)",
};

const actionButtonStyle: CSSProperties = {
  width: 24,
  height: 20,
  border: "1px solid var(--border2)",
  background: "none",
  color: "var(--text3)",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
  lineHeight: 1,
};

const actionMenuStyle: CSSProperties = {
  position: "absolute",
  top: 24,
  right: 0,
  zIndex: 20,
  width: 112,
  background: "var(--bg2)",
  border: "1px solid var(--border2)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  padding: 4,
  overflow: "hidden",
  boxSizing: "border-box",
};

const menuItemStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 8px",
  border: "none",
  background: "none",
  textAlign: "left",
  color: "var(--text2)",
  cursor: "pointer",
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
};

const noticeButtonStyle: CSSProperties = {
  border: "1px solid var(--border2)",
  background: "none",
  color: "var(--text2)",
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  cursor: "pointer",
  padding: "3px 8px",
};

const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.58)",
  zIndex: 2000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalStyle: CSSProperties = {
  width: 560,
  maxWidth: "100%",
  background: "var(--bg2)",
  border: "1px solid var(--border2)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
};

const modalHeaderStyle: CSSProperties = {
  height: 38,
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 14px",
  fontFamily: "var(--font-cond)",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  color: "var(--text2)",
};

const closeButtonStyle: CSSProperties = {
  border: "none",
  background: "none",
  color: "var(--text3)",
  cursor: "pointer",
  fontSize: 20,
  lineHeight: 1,
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text3)",
  marginBottom: 3,
  display: "block",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  resize: "vertical",
  background: "var(--bg3)",
  border: "1px solid var(--border2)",
  color: "var(--text)",
  padding: "6px 8px",
  fontFamily: "var(--font)",
  fontSize: 12,
  outline: "none",
  borderRadius: 2,
};
