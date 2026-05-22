import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { getAccounts } from "../api/accounts";
import { getCategories } from "../api/categories";
import { getLatestFxRates } from "../api/fx_rates";
import { getInstruments } from "../api/instruments";
import type { Instrument } from "../types/instrument";
import type { LatestFxRate } from "../types/fx_rate";
import {
  BatchCreateError,
  batchCreateTransactions,
  bulkTransactions,
  createTransaction,
  deleteTransaction,
  exportTransactionsCsv,
  getTransactionSummary,
  getTransactions,
  updateTransaction,
} from "../api/transactions";
import { ApiError } from "../api/client";
import Button from "../components/Button";
import Input from "../components/Input";
import Select from "../components/Select";
import Tag from "../components/Tag";
import type { Account } from "../types/account";
import type { CategoryNode, CategoryType } from "../types/category";
import type {
  BatchRowError,
  RecurrenceFrequency,
  Transaction,
  TransactionFilters,
  TransactionPayload,
  TransactionSummary,
  TransactionType,
} from "../types/transaction";
import {
  formatDateDisplay,
  formatMoney,
  paiseToInput,
  parseMoneyInput,
} from "../utils/format";

const TRANSACTION_TYPES: Array<{ value: TransactionType; label: string }> = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "credit_card_payment", label: "Card Payment" },
  { value: "loan_repayment", label: "Loan Repayment" },
  { value: "investment_buy", label: "Investment Buy" },
  { value: "investment_sell", label: "Investment Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "valuation_update", label: "Valuation Update" },
];

const RECURRENCE_OPTIONS: RecurrenceFrequency[] = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
  "quarterly",
  "annually",
];

const EMPTY_SUMMARY: TransactionSummary = {
  count: 0,
  total_income_paise: 0,
  total_expense_paise: 0,
  net_paise: 0,
};

interface FlatCategory {
  id: string;
  name: string;
  type: CategoryType;
  color_hex: string;
  level: number;
}

interface FilterState {
  search: string;
  dateFrom: string;
  dateTo: string;
  accountId: string;
  categoryId: string;
  type: "all" | TransactionType;
  tag: string;
  amountMin: string;
  amountMax: string;
}

interface TransactionFormState {
  type: TransactionType;
  date: string;
  accountId: string;
  transferAccountId: string;
  categoryId: string;
  amount: string;
  description: string;
  tags: string;
  notes: string;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  splitMode: boolean;
  splits: SplitFormState[];
  // investment fields (investment_buy / investment_sell / dividend)
  instrumentId: string;
  quantity: string;
  pricePerUnit: string;
  fees: string;
  fxRate: string;
}

interface SplitFormState {
  categoryId: string;
  amount: string;
  notes: string;
}

export default function TransactionsPage() {
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [latestFxRates, setLatestFxRates] = useState<LatestFxRate[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => {
    const base = defaultFilters();
    const accountId = searchParams.get("account_id");
    return accountId ? { ...base, accountId } : base;
  });
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => {
    const base = defaultFilters();
    const accountId = searchParams.get("account_id");
    return accountId ? { ...base, accountId } : base;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null);
  const [form, setForm] = useState<TransactionFormState>(() =>
    blankForm([], []),
  );
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkEntryMode, setBulkEntryMode] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [accountResponse, categoryResponse, instrumentResponse, fxResponse] = await Promise.all([
        getAccounts(),
        getCategories(),
        getInstruments(),
        getLatestFxRates(),
      ]);
      setAccounts(
        [...accountResponse.asset_groups, ...accountResponse.liability_groups]
          .flatMap((group) => group.accounts)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCategories(categoryResponse.categories);
      setInstruments(instrumentResponse.instruments);
      setLatestFxRates(fxResponse.latest);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Unable to load reference data",
      );
    }
  }, []);

  const loadTransactions = useCallback(
    async (append = false) => {
      if (append && !nextCursor) return;
      append ? setLoadingMore(true) : setLoading(true);
      setError("");

      try {
        const filters = buildApiFilters(
          appliedFilters,
          append ? nextCursor ?? undefined : undefined,
        );
        if (append) {
          const response = await getTransactions(filters);
          setTransactions((current) => [...current, ...response.transactions]);
          setNextCursor(response.next_cursor);
        } else {
          const [listResponse, summaryResponse] = await Promise.all([
            getTransactions(filters),
            getTransactionSummary({ ...filters, cursor: undefined }),
          ]);
          setTransactions(listResponse.transactions);
          setSummary(summaryResponse.summary);
          setNextCursor(listResponse.next_cursor);
          setSelectedIds(new Set());
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Unable to load transactions",
        );
      } finally {
        append ? setLoadingMore(false) : setLoading(false);
      }
    },
    [appliedFilters, nextCursor],
  );

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    void loadTransactions(false);
  }, [appliedFilters]);

  const refreshAfterMutation = async () => {
    await Promise.all([loadReferenceData(), loadTransactions(false)]);
  };

  const openCreateModal = () => {
    setEditingTransaction(null);
    setForm(blankForm(accounts, flatCategories));
    setFormError("");
    setModalOpen(true);
  };

  const openEditModal = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setForm(formFromTransaction(transaction));
    setFormError("");
    setActionMenuId(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingTransaction(null);
    setFormError("");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const payload = buildTransactionPayload(form, accounts);
      if (editingTransaction) {
        await updateTransaction(editingTransaction.id, payload);
      } else {
        await createTransaction(payload);
      }
      setModalOpen(false);
      setEditingTransaction(null);
      setFormError("");
      await refreshAfterMutation();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Unable to save transaction",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (transaction: Transaction) => {
    setActionMenuId(null);
    const confirmed = window.confirm(
      `Delete ${transaction.description}? The balance effect will be reversed.`,
    );
    if (!confirmed) return;

    setError("");
    try {
      await deleteTransaction(transaction.id);
      await refreshAfterMutation();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Unable to delete transaction",
      );
    }
  };

  const applyFilters = () => {
    setAppliedFilters(draftFilters);
  };

  const resetFilters = () => {
    const reset = defaultFilters();
    setDraftFilters(reset);
    setAppliedFilters(reset);
  };

  const handleCsvExport = async () => {
    setError("");
    try {
      const blob = await exportTransactionsCsv(buildApiFilters(appliedFilters));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "artha-transactions.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to export CSV");
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      if (current.size === transactions.length) return new Set();
      return new Set(transactions.map((transaction) => transaction.id));
    });
  };

  const runBulkAction = async (
    action: "soft_delete" | "add_tag" | "remove_tag" | "categorize",
  ) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      action === "soft_delete" &&
      !window.confirm(`Delete ${ids.length} selected transactions?`)
    ) {
      return;
    }

    setBulkWorking(true);
    setError("");
    try {
      await bulkTransactions({
        ids,
        action,
        category_id: action === "categorize" ? bulkCategoryId : undefined,
        tag: action === "add_tag" || action === "remove_tag" ? bulkTag : undefined,
      });
      setSelectedIds(new Set());
      setBulkTag("");
      await refreshAfterMutation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBulkWorking(false);
    }
  };

  if (isMobile) {
    return (
      <div style={{ minHeight: "100%", background: "var(--bg)" }}>
        <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          {/* Mobile Header with Filters Button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg2)",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setFilterSheetOpen(true)}
              title="Filters"
              style={{
                padding: "6px 10px",
                border: "1px solid var(--border)",
                background: "var(--bg3)",
                color: "var(--text2)",
                cursor: "pointer",
                fontFamily: "var(--font-cond)",
                fontSize: 10,
                textTransform: "uppercase",
                borderRadius: 2,
                position: "relative",
              }}
            >
              Filters
              {(draftFilters.search ||
                draftFilters.dateFrom ||
                draftFilters.dateTo ||
                draftFilters.accountId ||
                draftFilters.categoryId ||
                draftFilters.type !== "all" ||
                draftFilters.tag ||
                draftFilters.amountMin ||
                draftFilters.amountMax) && (
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 6,
                    height: 6,
                    background: "var(--accent)",
                    borderRadius: "50%",
                  }}
                />
              )}
            </button>
            <Button onClick={openCreateModal} size="sm" style={{ flex: 1 }}>
              + Add
            </Button>
          </div>

          {/* Main Content */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {bulkEntryMode ? (
              <BulkEntryPanel
                accounts={accounts}
                categories={flatCategories.filter((c) => c.type === "expense")}
                onSave={async () => {
                  setBulkEntryMode(false);
                  await refreshAfterMutation();
                }}
                onDiscard={() => setBulkEntryMode(false)}
              />
            ) : (
              <>
                <SummaryStripMobile summary={summary} />

                {error && (
                  <div style={noticeStyle("error")}>
                    {error}
                    <button
                      type="button"
                      onClick={() => void loadTransactions(false)}
                      style={noticeButtonStyle}
                    >
                      Retry
                    </button>
                  </div>
                )}

                {selectedIds.size > 0 && (
                  <BulkBarMobile
                    selectedCount={selectedIds.size}
                    categories={flatCategories}
                    categoryId={bulkCategoryId}
                    tag={bulkTag}
                    working={bulkWorking}
                    onCategoryChange={setBulkCategoryId}
                    onTagChange={setBulkTag}
                    onCategorize={() => void runBulkAction("categorize")}
                    onAddTag={() => void runBulkAction("add_tag")}
                    onRemoveTag={() => void runBulkAction("remove_tag")}
                    onDelete={() => void runBulkAction("soft_delete")}
                    onClear={() => setSelectedIds(new Set())}
                  />
                )}

                <TransactionListMobile
                  transactions={transactions}
                  loading={loading}
                  selectedIds={selectedIds}
                  onToggleSelected={toggleSelected}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: "12px 0 18px",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {nextCursor ? (
                    <Button
                      variant="ghost"
                      disabled={loadingMore}
                      onClick={() => void loadTransactions(true)}
                    >
                      {loadingMore ? "Loading" : "Load More"}
                    </Button>
                  ) : (
                    <span style={mutedCapsStyle}>End of result set</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filter Sheet */}
        {filterSheetOpen && (
          <FilterSheet
            filters={draftFilters}
            accounts={accounts}
            categories={flatCategories}
            onChange={setDraftFilters}
            onApply={() => {
              applyFilters();
              setFilterSheetOpen(false);
            }}
            onReset={() => {
              resetFilters();
              setFilterSheetOpen(false);
            }}
            onExport={handleCsvExport}
            onBulkEntry={() => {
              setBulkEntryMode(true);
              setFilterSheetOpen(false);
            }}
            onClose={() => setFilterSheetOpen(false)}
          />
        )}

        {modalOpen && (
          <TransactionModalMobile
            form={form}
            editingTransaction={editingTransaction}
            accounts={accounts}
            categories={flatCategories}
            instruments={instruments}
            latestFxRates={latestFxRates}
            error={formError}
            saving={saving}
            onClose={closeModal}
            onSubmit={handleSubmit}
            onChange={setForm}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 1,
          minHeight: "100%",
          background: "var(--border)",
        }}
      >
        <main style={{ background: "var(--bg2)", minWidth: 0 }}>
          {bulkEntryMode ? (
            <BulkEntryPanel
              accounts={accounts}
              categories={flatCategories.filter((c) => c.type === "expense")}
              onSave={async () => {
                setBulkEntryMode(false);
                await refreshAfterMutation();
              }}
              onDiscard={() => setBulkEntryMode(false)}
            />
          ) : (
            <>
          <SummaryStrip summary={summary} />
          <FilterBar
            filters={draftFilters}
            accounts={accounts}
            categories={flatCategories}
            onChange={setDraftFilters}
            onApply={applyFilters}
            onReset={resetFilters}
            onExport={handleCsvExport}
            onAdd={openCreateModal}
            onBulkEntry={() => setBulkEntryMode(true)}
          />

          {error && (
            <div style={noticeStyle("error")}>
              {error}
              <button
                type="button"
                onClick={() => void loadTransactions(false)}
                style={noticeButtonStyle}
              >
                Retry
              </button>
            </div>
          )}

          {selectedIds.size > 0 && (
            <BulkBar
              selectedCount={selectedIds.size}
              categories={flatCategories}
              categoryId={bulkCategoryId}
              tag={bulkTag}
              working={bulkWorking}
              onCategoryChange={setBulkCategoryId}
              onTagChange={setBulkTag}
              onCategorize={() => void runBulkAction("categorize")}
              onAddTag={() => void runBulkAction("add_tag")}
              onRemoveTag={() => void runBulkAction("remove_tag")}
              onDelete={() => void runBulkAction("soft_delete")}
              onClear={() => setSelectedIds(new Set())}
            />
          )}

          <TransactionTable
            transactions={transactions}
            loading={loading}
            selectedIds={selectedIds}
            actionMenuId={actionMenuId}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
            onToggleMenu={setActionMenuId}
            onEdit={openEditModal}
            onDelete={handleDelete}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "12px 0 18px",
              borderTop: "1px solid var(--border)",
            }}
          >
            {nextCursor ? (
              <Button
                variant="ghost"
                disabled={loadingMore}
                onClick={() => void loadTransactions(true)}
              >
                {loadingMore ? "Loading" : "Load More"}
              </Button>
            ) : (
              <span style={mutedCapsStyle}>End of result set</span>
            )}
          </div>
            </>
          )}
        </main>

        <TransactionsSidebar
          accounts={accounts}
          categories={flatCategories}
          transactions={transactions}
          onAdd={openCreateModal}
        />
      </div>

      {modalOpen && (
        <TransactionModal
          form={form}
          editingTransaction={editingTransaction}
          accounts={accounts}
          categories={flatCategories}
          instruments={instruments}
          latestFxRates={latestFxRates}
          error={formError}
          saving={saving}
          onClose={closeModal}
          onSubmit={handleSubmit}
          onChange={setForm}
        />
      )}
    </div>
  );
}

function SummaryStrip({ summary }: { summary: TransactionSummary }) {
  const metrics = [
    {
      label: "Transactions",
      value: summary.count.toString(),
      color: "var(--text)",
      mono: true,
    },
    {
      label: "Income",
      value: formatMoney(summary.total_income_paise),
      color: "var(--green)",
      mono: true,
    },
    {
      label: "Expenses",
      value: formatMoney(summary.total_expense_paise),
      color: "var(--red)",
      mono: true,
    },
    {
      label: "Net",
      value: formatMoney(summary.net_paise),
      color: summary.net_paise >= 0 ? "var(--accent)" : "var(--red)",
      mono: true,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 1,
        background: "var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          style={{ background: "var(--bg3)", padding: "9px 12px" }}
        >
          <MetricLabel>{metric.label}</MetricLabel>
          <div
            style={{
              fontFamily: metric.mono ? "var(--font-mono)" : "var(--font)",
              fontSize: 20,
              color: metric.color,
              marginTop: 5,
              lineHeight: 1.1,
            }}
          >
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryStripMobile({ summary }: { summary: TransactionSummary }) {
  const metrics = [
    {
      label: "Transactions",
      value: summary.count.toString(),
      color: "var(--text)",
      mono: true,
    },
    {
      label: "Income",
      value: formatMoney(summary.total_income_paise),
      color: "var(--green)",
      mono: true,
    },
    {
      label: "Expenses",
      value: formatMoney(summary.total_expense_paise),
      color: "var(--red)",
      mono: true,
    },
    {
      label: "Net",
      value: formatMoney(summary.net_paise),
      color: summary.net_paise >= 0 ? "var(--accent)" : "var(--red)",
      mono: true,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 1,
        background: "var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          style={{ background: "var(--bg3)", padding: "8px 10px" }}
        >
          <div
            style={{
              fontSize: 8,
              fontFamily: "var(--font-cond)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text3)",
            }}
          >
            {metric.label}
          </div>
          <div
            style={{
              fontFamily: metric.mono ? "var(--font-mono)" : "var(--font)",
              fontSize: 14,
              color: metric.color,
              marginTop: 3,
              lineHeight: 1.1,
            }}
          >
            {metric.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function TransactionListMobile({
  transactions,
  loading,
  selectedIds,
  onToggleSelected,
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (loading) return <EmptyPanel label="Loading transactions" />;
  if (transactions.length === 0) return <EmptyPanel label="No transactions" />;

  return (
    <div style={{ flex: 1 }}>
      {transactions.map((transaction) => {
        const tone = transactionTone(transaction.type);
        return (
          <div
            key={transaction.id}
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
              background: selectedIds.has(transaction.id)
                ? "var(--bg3)"
                : "var(--bg2)",
              cursor: "pointer",
            }}
            onClick={() => onEdit(transaction)}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={selectedIds.has(transaction.id)}
                onChange={() => onToggleSelected(transaction.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ marginTop: 4, cursor: "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text3)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {formatDateDisplay(transaction.date)}
                  </span>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: tone.tagVariant === "income" ? "var(--green)" : tone.tagVariant === "expense" ? "var(--red)" : "var(--text2)",
                    }}
                  />
                </div>
                <div
                  style={{
                    fontFamily: "var(--font)",
                    fontSize: 13,
                    color: "var(--text)",
                    marginBottom: 3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {transaction.description}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 10,
                    color: "var(--text3)",
                  }}
                >
                  {transaction.account_name && <span>{transaction.account_name}</span>}
                  {transaction.category_name && (
                    <span>{transaction.category_name}</span>
                  )}
                  {transaction.splits.length > 0 && (
                    <span>Split {transaction.splits.length}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    color: tone.color,
                    fontWeight: 500,
                  }}
                >
                  {tone.prefix}
                  {formatMoney(transaction.inr_amount_paise)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(transaction);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--red)",
                    cursor: "pointer",
                    fontSize: 10,
                    fontFamily: "var(--font-cond)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BulkBarMobile({
  selectedCount,
  categories,
  categoryId,
  tag,
  working,
  onCategoryChange,
  onTagChange,
  onCategorize,
  onAddTag,
  onRemoveTag,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  categories: FlatCategory[];
  categoryId: string;
  tag: string;
  working: boolean;
  onCategoryChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onCategorize: () => void;
  onAddTag: () => void;
  onRemoveTag: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--bg3)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={mutedCapsStyle}>{selectedCount} selected</div>
      <Select
        label="Category"
        value={categoryId}
        onChange={(event) => onCategoryChange(event.target.value)}
      >
        <option value="">Select category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {categoryLabel(category)}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="ghost"
        disabled={working || !categoryId}
        onClick={onCategorize}
      >
        Categorize
      </Button>
      <Input
        label="Tag"
        value={tag}
        onChange={(event) => onTagChange(event.target.value)}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <Button
          type="button"
          variant="ghost"
          disabled={working || !tag.trim()}
          onClick={onAddTag}
          style={{ flex: 1 }}
        >
          Add Tag
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={working || !tag.trim()}
          onClick={onRemoveTag}
          style={{ flex: 1 }}
        >
          Remove
        </Button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button
          type="button"
          variant="ghost"
          disabled={working}
          onClick={onDelete}
          style={{ flex: 1, color: "var(--red)" }}
        >
          Delete
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={working}
          onClick={onClear}
          style={{ flex: 1 }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function FilterSheet({
  filters,
  accounts,
  categories,
  onChange,
  onApply,
  onReset,
  onExport,
  onBulkEntry,
  onClose,
}: {
  filters: FilterState;
  accounts: Account[];
  categories: FlatCategory[];
  onChange: (filters: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  onBulkEntry: () => void;
  onClose: () => void;
}) {
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1500,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "var(--bg2)",
          borderTop: "1px solid var(--border)",
          borderRadius: "12px 12px 0 0",
          maxHeight: "85vh",
          overflowY: "auto",
          zIndex: 1501,
          animation: "slideUp 0.22s ease",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div
            style={{
              width: 32,
              height: 3,
              background: "var(--border2)",
              borderRadius: 1.5,
            }}
          />
        </div>

        {/* Close button */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "0 12px 8px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text3)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>

        {/* Filter content */}
        <div style={{ padding: "8px 12px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Input
              label="Search"
              value={filters.search}
              onChange={(event) => update("search", event.target.value)}
            />
            <Input
              label="From"
              type="date"
              value={filters.dateFrom}
              onChange={(event) => update("dateFrom", event.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={filters.dateTo}
              onChange={(event) => update("dateTo", event.target.value)}
            />
            <Select
              label="Account"
              value={filters.accountId}
              onChange={(event) => update("accountId", event.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            <Select
              label="Type"
              value={filters.type}
              onChange={(event) =>
                update("type", event.target.value as FilterState["type"])
              }
            >
              <option value="all">All types</option>
              {TRANSACTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <Select
              label="Category"
              value={filters.categoryId}
              onChange={(event) => update("categoryId", event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category)}
                </option>
              ))}
            </Select>
            <Input
              label="Tag"
              value={filters.tag}
              onChange={(event) => update("tag", event.target.value)}
            />
            <Input
              label="Min"
              value={filters.amountMin}
              inputMode="decimal"
              onChange={(event) => update("amountMin", event.target.value)}
            />
            <Input
              label="Max"
              value={filters.amountMax}
              inputMode="decimal"
              onChange={(event) => update("amountMax", event.target.value)}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Button
                type="button"
                onClick={onApply}
                style={{ flex: 1 }}
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onReset}
                style={{ flex: 1 }}
              >
                Reset
              </Button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Button
                type="button"
                variant="ghost"
                onClick={onExport}
                style={{ width: "100%" }}
              >
                Export CSV
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onBulkEntry}
                style={{ width: "100%" }}
              >
                Bulk Entry
              </Button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

function TransactionModalMobile({
  form,
  editingTransaction,
  accounts,
  categories,
  instruments,
  latestFxRates,
  error,
  saving,
  onClose,
  onSubmit,
  onChange,
}: {
  form: TransactionFormState;
  editingTransaction: Transaction | null;
  accounts: Account[];
  categories: FlatCategory[];
  instruments: Instrument[];
  latestFxRates: LatestFxRate[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (form: TransactionFormState) => void;
}) {
  const update = <K extends keyof TransactionFormState>(
    key: K,
    value: TransactionFormState[K],
  ) => onChange({ ...form, [key]: value });
  const expectedCategoryType = categoryTypeForTransaction(form.type);
  const availableCategories = expectedCategoryType
    ? categories.filter((category) => category.type === expectedCategoryType)
    : [];
  const canSplit = form.type === "income" || form.type === "expense";
  const needsDestination = requiresDestination(form.type);
  const showInvestmentFields = isInvestmentType(form.type);
  const needsInvestmentDetail = requiresInvestmentDetail(form.type);
  const sourceAccount = accounts.find((account) => account.id === form.accountId) ?? null;
  const destinationAccount =
    accounts.find((account) => account.id === form.transferAccountId) ?? null;
  const isCrossCurrencyTransfer =
    form.type === "transfer" &&
    sourceAccount !== null &&
    destinationAccount !== null &&
    sourceAccount.currency !== destinationAccount.currency;
  const latestFxRate = useMemo(
    () =>
      sourceAccount && destinationAccount
        ? findLatestFxRate(
            latestFxRates,
            sourceAccount.currency,
            destinationAccount.currency,
          )
        : null,
    [destinationAccount, latestFxRates, sourceAccount],
  );
  const computedDestinationAmount = useMemo(() => {
    if (!isCrossCurrencyTransfer || !form.amount.trim() || !form.fxRate.trim()) {
      return null;
    }
    try {
      return Math.round(parseMoneyInput(form.amount) * parseRateInput(form.fxRate));
    } catch {
      return null;
    }
  }, [form.amount, form.fxRate, isCrossCurrencyTransfer]);

  useEffect(() => {
    if (isCrossCurrencyTransfer && !form.fxRate.trim() && latestFxRate) {
      onChange({ ...form, fxRate: formatRateInput(latestFxRate.rate) });
    } else if (!isCrossCurrencyTransfer && form.fxRate.trim()) {
      onChange({ ...form, fxRate: "" });
    }
  }, [form, isCrossCurrencyTransfer, latestFxRate, onChange]);

  const computedTotal = useMemo(() => {
    if (!needsInvestmentDetail || !form.quantity || !form.pricePerUnit) return null;
    try {
      const qty = parseFloat(form.quantity);
      const price = parseMoneyInput(form.pricePerUnit);
      const fees = form.fees.trim() ? parseMoneyInput(form.fees) : 0;
      if (isNaN(qty) || qty <= 0 || price <= 0) return null;
      const gross = Math.round(qty * price);
      return form.type === "investment_buy" ? gross + fees : Math.max(0, gross - fees);
    } catch {
      return null;
    }
  }, [needsInvestmentDetail, form.type, form.quantity, form.pricePerUnit, form.fees]);

  const updateType = (type: TransactionType) => {
    const nextCategoryType = categoryTypeForTransaction(type);
    const nextCategories = nextCategoryType
      ? categories.filter((category) => category.type === nextCategoryType)
      : [];
    const canKeepCategory =
      nextCategoryType &&
      nextCategories.some((category) => category.id === form.categoryId);
    const canKeepSplits =
      canSplitType(type) &&
      form.splitMode &&
      form.splits.every((split) =>
        nextCategories.some((category) => category.id === split.categoryId),
      );
    onChange({
      ...form,
      type,
      transferAccountId: requiresDestination(type) ? form.transferAccountId : "",
      categoryId: nextCategoryType
        ? canKeepCategory
          ? form.categoryId
          : nextCategories[0]?.id ?? ""
        : "",
      splitMode: canSplitType(type) ? form.splitMode : false,
      splits: canSplitType(type)
        ? canKeepSplits
          ? form.splits
          : form.splitMode
            ? [blankSplit(nextCategories[0]?.id ?? "")]
            : []
        : [],
      instrumentId: isInvestmentType(type) ? form.instrumentId : "",
      quantity: isInvestmentType(type) ? form.quantity : "",
      pricePerUnit: isInvestmentType(type) ? form.pricePerUnit : "",
      fees: isInvestmentType(type) ? form.fees : "",
      fxRate: type === "transfer" ? form.fxRate : "",
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 2000,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "var(--bg2)",
          borderTop: "1px solid var(--border)",
          borderRadius: "12px 12px 0 0",
          maxHeight: "90vh",
          overflowY: "auto",
          zIndex: 2001,
          animation: "slideUp 0.22s ease",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div
            style={{
              width: 32,
              height: 3,
              background: "var(--border2)",
              borderRadius: 1.5,
            }}
          />
        </div>

        <form
          style={{ padding: "0 12px 20px" }}
          onSubmit={onSubmit}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: "var(--font-cond)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text2)", marginBottom: 10 }}>
              {editingTransaction ? "Edit Transaction" : "Add Transaction"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Select
              label="Type"
              value={form.type}
              onChange={(event) => updateType(event.target.value as TransactionType)}
            >
              {TRANSACTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <Input
              label="Description"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              required
            />
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(event) => update("date", event.target.value)}
              required
            />

            <Select
              label="Account"
              value={form.accountId}
              onChange={(event) => update("accountId", event.target.value)}
              required
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>

            {needsDestination && (
              <Select
                label="Destination"
                value={form.transferAccountId}
                onChange={(event) => update("transferAccountId", event.target.value)}
                required
              >
                <option value="">Select destination</option>
                {accounts
                  .filter((account) => account.id !== form.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </Select>
            )}

            {!showInvestmentFields && (
              <Input
                label="Amount"
                value={form.amount}
                inputMode="decimal"
                onChange={(event) => update("amount", event.target.value)}
                required
              />
            )}

            {isCrossCurrencyTransfer && sourceAccount && destinationAccount && (
              <div
                style={{
                  padding: "10px 12px",
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-cond)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text3)",
                    marginBottom: 8,
                  }}
                >
                  FX Transfer
                </div>
                <Input
                  label={`Rate ${sourceAccount.currency}/${destinationAccount.currency}`}
                  value={form.fxRate}
                  inputMode="decimal"
                  onChange={(event) => update("fxRate", event.target.value)}
                  placeholder="83.450000"
                  required
                />
                <div style={{ marginTop: 8 }}>
                  <div style={metricLabelStyle}>Destination Credit</div>
                  <div
                    style={{
                      marginTop: 5,
                      minHeight: 28,
                      display: "flex",
                      alignItems: "center",
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      padding: "5px 8px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color:
                        computedDestinationAmount !== null
                          ? "var(--text)"
                          : "var(--text3)",
                    }}
                  >
                    {computedDestinationAmount !== null
                      ? formatMoney(computedDestinationAmount, destinationAccount.currency)
                      : "--"}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text3)",
                  }}
                >
                  {latestFxRate
                    ? `Latest ${latestFxRate.sourceLabel}: ${formatRateInput(latestFxRate.rate)} · ${formatDateDisplay(latestFxRate.date)}`
                    : "No saved rate for this pair"}
                </div>
              </div>
            )}

            {showInvestmentFields && (
              <div style={{ padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--border)" }}>
                <div style={{ fontFamily: "var(--font-cond)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 8 }}>
                  Investment Detail
                </div>
                <Select
                  label="Instrument"
                  value={form.instrumentId}
                  onChange={(event) => update("instrumentId", event.target.value)}
                  required={needsInvestmentDetail}
                >
                  <option value="">Select instrument</option>
                  {instruments.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name}{inst.ticker ? ` (${inst.ticker})` : ""}
                    </option>
                  ))}
                </Select>
                {needsInvestmentDetail && (
                  <>
                    <Input
                      label="Quantity"
                      value={form.quantity}
                      inputMode="decimal"
                      onChange={(event) => update("quantity", event.target.value)}
                      placeholder="e.g. 10.5"
                      required
                    />
                    <Input
                      label="Price per unit"
                      value={form.pricePerUnit}
                      inputMode="decimal"
                      onChange={(event) => update("pricePerUnit", event.target.value)}
                      placeholder="e.g. 1500.00"
                      required
                    />
                    <Input
                      label="Fees"
                      value={form.fees}
                      inputMode="decimal"
                      onChange={(event) => update("fees", event.target.value)}
                      placeholder="0.00"
                    />
                  </>
                )}
                {!needsInvestmentDetail && (
                  <Input
                    label="Amount"
                    value={form.amount}
                    inputMode="decimal"
                    onChange={(event) => update("amount", event.target.value)}
                    required
                  />
                )}
                {needsInvestmentDetail && computedTotal !== null && (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-cond)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)" }}>
                      {form.type === "investment_buy" ? "Total debit" : "Net proceeds"}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>
                      {paiseToInput(computedTotal)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {expectedCategoryType && !form.splitMode && (
              <Select
                label="Category"
                value={form.categoryId}
                onChange={(event) => update("categoryId", event.target.value)}
                required
              >
                <option value="">Select category</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </Select>
            )}

            <Input
              label="Tags"
              value={form.tags}
              onChange={(event) => update("tags", event.target.value)}
              placeholder="medical, tax"
            />

            {canSplit && (
              <div>
                <label style={checkboxLabelStyle}>
                  <input
                    type="checkbox"
                    checked={form.splitMode}
                    onChange={(event) =>
                      onChange({
                        ...form,
                        splitMode: event.target.checked,
                        categoryId: event.target.checked ? "" : form.categoryId,
                        splits: event.target.checked
                          ? form.splits.length > 0
                            ? form.splits
                            : [blankSplit(availableCategories[0]?.id ?? "")]
                          : [],
                      })
                    }
                  />
                  Split transaction
                </label>
                {form.splitMode && (
                  <SplitEditor
                    splits={form.splits}
                    categories={availableCategories}
                    onChange={(splits) => update("splits", splits)}
                  />
                )}
              </div>
            )}

            <div>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={form.isRecurring}
                  onChange={(event) => update("isRecurring", event.target.checked)}
                />
                Recurring
              </label>
              {form.isRecurring && (
                <div style={{ width: 180, marginTop: 6 }}>
                  <Select
                    label="Frequency"
                    value={form.recurrenceFrequency}
                    onChange={(event) =>
                      update(
                        "recurrenceFrequency",
                        event.target.value as RecurrenceFrequency,
                      )
                    }
                  >
                    {RECURRENCE_OPTIONS.map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {frequency}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <div>
              <label style={labelStyle}>Notes</label>
              <textarea
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
                rows={3}
                style={textareaStyle}
              />
            </div>

            {error && (
              <div style={{ ...noticeStyle("error"), marginTop: 10 }}>{error}</div>
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
                  : editingTransaction
                    ? "Save Transaction"
                    : "Create Transaction"}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

// ─── Bulk Entry ───────────────────────────────────────────────────────────────

interface BulkRow {
  key: string;
  date: string;
  accountId: string;
  description: string;
  amount: string;
  categoryId: string;
  notes: string;
}

const BULK_COLS = ["date", "accountId", "description", "amount", "categoryId", "notes"] as const;
type BulkCol = (typeof BULK_COLS)[number];

let _rowKeyCounter = 0;
function newRow(prev?: BulkRow): BulkRow {
  return {
    key: String(++_rowKeyCounter),
    date: prev?.date ?? new Date().toISOString().slice(0, 10),
    accountId: prev?.accountId ?? "",
    description: "",
    amount: "",
    categoryId: prev?.categoryId ?? "",
    notes: "",
  };
}

function rowIsEmpty(row: BulkRow): boolean {
  return !row.description.trim() && !row.amount.trim() && !row.notes.trim();
}

function rowIsComplete(row: BulkRow): boolean {
  return (
    !!row.date &&
    !!row.accountId &&
    !!row.description.trim() &&
    !!row.amount.trim() &&
    !!row.categoryId
  );
}

function BulkEntryPanel({
  accounts,
  categories,
  onSave,
  onDiscard,
}: {
  accounts: Account[];
  categories: FlatCategory[];
  onSave: () => Promise<void>;
  onDiscard: () => void;
}) {
  const [rows, setRows] = useState<BulkRow[]>(() => [newRow()]);
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map());
  const [globalError, setGlobalError] = useState("");
  const [saving, setSaving] = useState(false);

  const cellRefs = useRef<Map<string, HTMLElement>>(new Map());

  const setCellRef = (rowKey: string, col: BulkCol, el: HTMLElement | null) => {
    const k = `${rowKey}:${col}`;
    if (el) cellRefs.current.set(k, el);
    else cellRefs.current.delete(k);
  };

  const focusCell = (rowKey: string, col: BulkCol) => {
    cellRefs.current.get(`${rowKey}:${col}`)?.focus();
  };

  const moveFocus = (rowKey: string, col: BulkCol, direction: "next-col" | "next-row") => {
    const colIdx = BULK_COLS.indexOf(col);
    setRows((current) => {
      const rowIdx = current.findIndex((r) => r.key === rowKey);
      if (rowIdx === -1) return current;

      if (direction === "next-col") {
        if (colIdx < BULK_COLS.length - 1) {
          setTimeout(() => focusCell(rowKey, BULK_COLS[colIdx + 1]), 0);
        } else if (rowIdx < current.length - 1) {
          setTimeout(() => focusCell(current[rowIdx + 1].key, BULK_COLS[0]), 0);
        }
      } else {
        const targetRowIdx = rowIdx + 1;
        if (targetRowIdx < current.length) {
          setTimeout(() => focusCell(current[targetRowIdx].key, col), 0);
        }
      }
      return current;
    });
  };

  const updateRow = (key: string, field: BulkCol, value: string) => {
    setRows((current) => {
      const rowIdx = current.findIndex((r) => r.key === key);
      if (rowIdx === -1) return current;
      const updated = current.map((r) => (r.key === key ? { ...r, [field]: value } : r));
      // Only append a new trailing row when the LAST row transitions from empty → non-empty.
      const isLastRow = rowIdx === current.length - 1;
      if (isLastRow && rowIsEmpty(current[rowIdx]) && !rowIsEmpty(updated[rowIdx])) {
        return [...updated, newRow(updated[rowIdx])];
      }
      return updated;
    });
    // Clear this row's error as the user corrects it.
    setRowErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const removeRow = (key: string) => {
    setRows((current) => {
      const next = current.filter((r) => r.key !== key);
      return next.length === 0 ? [newRow()] : next;
    });
  };

  const handleSave = async () => {
    setGlobalError("");
    setRowErrors(new Map());

    const nonEmpty = rows.filter((r) => !rowIsEmpty(r));
    if (nonEmpty.length === 0) {
      setGlobalError("Add at least one transaction before saving.");
      return;
    }

    // Local completeness check
    const localErrors = new Map<string, string>();
    nonEmpty.forEach((row) => {
      if (!rowIsComplete(row)) {
        const missing = [];
        if (!row.date) missing.push("date");
        if (!row.accountId) missing.push("account");
        if (!row.description.trim()) missing.push("description");
        if (!row.amount.trim()) missing.push("amount");
        if (!row.categoryId) missing.push("category");
        localErrors.set(row.key, `Missing: ${missing.join(", ")}`);
      }
    });
    if (localErrors.size > 0) {
      setRowErrors(localErrors);
      return;
    }

    const payload = nonEmpty.map((row) => ({
      date: row.date,
      account_id: row.accountId,
      description: row.description.trim(),
      amount_paise: parseMoneyInput(row.amount),
      category_id: row.categoryId,
      notes: row.notes.trim() || undefined,
    }));

    setSaving(true);
    try {
      await batchCreateTransactions({ transactions: payload });
      await onSave();
    } catch (err) {
      if (err instanceof BatchCreateError && err.rowErrors.length > 0) {
        const serverErrors = new Map<string, string>();
        err.rowErrors.forEach(({ row, message }) => {
          const rowKey = nonEmpty[row]?.key;
          if (rowKey) serverErrors.set(rowKey, message);
        });
        setRowErrors(serverErrors);
        setGlobalError("Some rows failed validation — fix them and try again.");
      } else {
        setGlobalError(err instanceof Error ? err.message : "Failed to save transactions.");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    const hasData = rows.some((r) => !rowIsEmpty(r));
    if (hasData && !window.confirm("Discard all unsaved rows?")) return;
    onDiscard();
  };

  const nonEmptyCount = rows.filter((r) => !rowIsEmpty(r)).length;

  const colWidths = "120px 160px 1fr 110px 160px 1fr 32px";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg3)",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-condensed)", fontSize: 13, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Bulk Expense Entry
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={handleDiscard} disabled={saving}>
            Discard
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || nonEmptyCount === 0}>
            {saving ? "Saving…" : `Save ${nonEmptyCount > 0 ? nonEmptyCount : ""} Transaction${nonEmptyCount !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>

      {globalError && (
        <div style={{ padding: "8px 12px", background: "color-mix(in srgb, var(--red) 12%, var(--bg2))", color: "var(--red)", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
          {globalError}
        </div>
      )}

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: colWidths,
          gap: 1,
          background: "var(--border)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {["Date", "Account", "Description", "Amount", "Category", "Notes", ""].map((h) => (
          <div
            key={h}
            style={{
              background: "var(--bg3)",
              padding: "5px 8px",
              fontFamily: "var(--font-condensed)",
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {rows.map((row) => {
          const rowErr = rowErrors.get(row.key);
          const isEmpty = rowIsEmpty(row);
          return (
            <div key={row.key}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: colWidths,
                  gap: 1,
                  background: "var(--border)",
                  borderLeft: rowErr ? "3px solid var(--red)" : "3px solid transparent",
                }}
              >
                {/* Date */}
                <div style={{ background: "var(--bg2)" }}>
                  <input
                    ref={(el) => setCellRef(row.key, "date", el)}
                    type="date"
                    value={row.date}
                    onChange={(e) => updateRow(row.key, "date", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "date", "next-row"); }
                      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); moveFocus(row.key, "date", "next-col"); }
                    }}
                    style={cellInputStyle}
                  />
                </div>

                {/* Account */}
                <div style={{ background: "var(--bg2)" }}>
                  <select
                    ref={(el) => setCellRef(row.key, "accountId", el)}
                    value={row.accountId}
                    onChange={(e) => updateRow(row.key, "accountId", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "accountId", "next-row"); }
                      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); moveFocus(row.key, "accountId", "next-col"); }
                    }}
                    style={cellSelectStyle}
                  >
                    <option value="">— account —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                {/* Description */}
                <div style={{ background: "var(--bg2)" }}>
                  <input
                    ref={(el) => setCellRef(row.key, "description", el)}
                    type="text"
                    value={row.description}
                    placeholder="description"
                    onChange={(e) => updateRow(row.key, "description", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "description", "next-row"); }
                      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); moveFocus(row.key, "description", "next-col"); }
                    }}
                    style={cellInputStyle}
                  />
                </div>

                {/* Amount */}
                <div style={{ background: "var(--bg2)" }}>
                  <input
                    ref={(el) => setCellRef(row.key, "amount", el)}
                    type="text"
                    inputMode="decimal"
                    value={row.amount}
                    placeholder="0.00"
                    onChange={(e) => updateRow(row.key, "amount", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "amount", "next-row"); }
                      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); moveFocus(row.key, "amount", "next-col"); }
                    }}
                    style={{ ...cellInputStyle, fontFamily: "var(--font-mono)", textAlign: "right" }}
                  />
                </div>

                {/* Category */}
                <div style={{ background: "var(--bg2)" }}>
                  <select
                    ref={(el) => setCellRef(row.key, "categoryId", el)}
                    value={row.categoryId}
                    onChange={(e) => updateRow(row.key, "categoryId", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "categoryId", "next-row"); }
                      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); moveFocus(row.key, "categoryId", "next-col"); }
                    }}
                    style={cellSelectStyle}
                  >
                    <option value="">— category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{categoryLabel(c)}</option>
                    ))}
                  </select>
                </div>

                {/* Notes */}
                <div style={{ background: "var(--bg2)" }}>
                  <input
                    ref={(el) => setCellRef(row.key, "notes", el)}
                    type="text"
                    value={row.notes}
                    placeholder="optional"
                    onChange={(e) => updateRow(row.key, "notes", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); moveFocus(row.key, "notes", "next-row"); }
                    }}
                    style={cellInputStyle}
                  />
                </div>

                {/* Remove */}
                <div style={{ background: "var(--bg2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {!isEmpty && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      title="Remove row"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--text-muted)",
                        fontSize: 14,
                        lineHeight: 1,
                        padding: "2px 4px",
                        borderRadius: 2,
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--red)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              {rowErr && (
                <div style={{ padding: "3px 8px 3px 14px", fontSize: 11, color: "var(--red)", background: "color-mix(in srgb, var(--red) 8%, var(--bg2))", borderLeft: "3px solid var(--red)" }}>
                  {rowErr}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border)", background: "var(--bg3)", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-condensed)" }}>
          Tab — next cell &nbsp;·&nbsp; Enter — next row &nbsp;·&nbsp; New rows added automatically
        </span>
      </div>
    </div>
  );
}

const cellInputStyle: CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  outline: "none",
  padding: "7px 8px",
  fontFamily: "var(--font)",
  fontSize: 13,
  color: "var(--text)",
  boxSizing: "border-box",
};

const cellSelectStyle: CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  outline: "none",
  padding: "7px 8px",
  fontFamily: "var(--font)",
  fontSize: 13,
  color: "var(--text)",
  boxSizing: "border-box",
  cursor: "pointer",
};

function FilterBar({
  filters,
  accounts,
  categories,
  onChange,
  onApply,
  onReset,
  onExport,
  onAdd,
  onBulkEntry,
}: {
  filters: FilterState;
  accounts: Account[];
  categories: FlatCategory[];
  onChange: (filters: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  onAdd: () => void;
  onBulkEntry: () => void;
}) {
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 120px 120px 150px 150px",
        gap: 8,
        padding: 10,
        background: "var(--bg2)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <Input
        label="Search"
        value={filters.search}
        onChange={(event) => update("search", event.target.value)}
      />
      <Input
        label="From"
        type="date"
        value={filters.dateFrom}
        onChange={(event) => update("dateFrom", event.target.value)}
      />
      <Input
        label="To"
        type="date"
        value={filters.dateTo}
        onChange={(event) => update("dateTo", event.target.value)}
      />
      <Select
        label="Account"
        value={filters.accountId}
        onChange={(event) => update("accountId", event.target.value)}
      >
        <option value="">All accounts</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
      <Select
        label="Type"
        value={filters.type}
        onChange={(event) =>
          update("type", event.target.value as FilterState["type"])
        }
      >
        <option value="all">All types</option>
        {TRANSACTION_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </Select>

      <Select
        label="Category"
        value={filters.categoryId}
        onChange={(event) => update("categoryId", event.target.value)}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {categoryLabel(category)}
          </option>
        ))}
      </Select>
      <Input
        label="Tag"
        value={filters.tag}
        onChange={(event) => update("tag", event.target.value)}
      />
      <Input
        label="Min"
        value={filters.amountMin}
        inputMode="decimal"
        onChange={(event) => update("amountMin", event.target.value)}
      />
      <Input
        label="Max"
        value={filters.amountMax}
        inputMode="decimal"
        onChange={(event) => update("amountMax", event.target.value)}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          alignSelf: "end",
        }}
      >
        <Button type="button" onClick={onApply}>
          Apply
        </Button>
        <Button type="button" variant="ghost" onClick={onReset}>
          Reset
        </Button>
      </div>
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={mutedCapsStyle}>Cursor sort: date desc</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onExport}>
            Export CSV
          </Button>
          <Button type="button" variant="ghost" onClick={onBulkEntry}>
            Bulk Entry
          </Button>
          <Button type="button" onClick={onAdd}>
            + Add Transaction
          </Button>
        </div>
      </div>
    </div>
  );
}

function BulkBar({
  selectedCount,
  categories,
  categoryId,
  tag,
  working,
  onCategoryChange,
  onTagChange,
  onCategorize,
  onAddTag,
  onRemoveTag,
  onDelete,
  onClear,
}: {
  selectedCount: number;
  categories: FlatCategory[];
  categoryId: string;
  tag: string;
  working: boolean;
  onCategoryChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onCategorize: () => void;
  onAddTag: () => void;
  onRemoveTag: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 110px 110px 110px 110px 74px",
        gap: 8,
        padding: "8px 10px",
        background: "var(--bg3)",
        borderBottom: "1px solid var(--border)",
        alignItems: "end",
      }}
    >
      <div style={mutedCapsStyle}>{selectedCount} selected</div>
      <Select
        label="Category"
        value={categoryId}
        onChange={(event) => onCategoryChange(event.target.value)}
      >
        <option value="">Select category</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {categoryLabel(category)}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="ghost"
        disabled={working || !categoryId}
        onClick={onCategorize}
      >
        Categorize
      </Button>
      <Input
        label="Tag"
        value={tag}
        onChange={(event) => onTagChange(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        disabled={working || !tag.trim()}
        onClick={onAddTag}
      >
        Add Tag
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={working || !tag.trim()}
        onClick={onRemoveTag}
      >
        Remove
      </Button>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          style={{ ...smallIconButtonStyle, color: "var(--red)" }}
          disabled={working}
          onClick={onDelete}
          title="Delete selected"
        >
          Del
        </button>
        <button
          type="button"
          style={smallIconButtonStyle}
          disabled={working}
          onClick={onClear}
          title="Clear selection"
        >
          Clr
        </button>
      </div>
    </div>
  );
}

function TransactionTable({
  transactions,
  loading,
  selectedIds,
  actionMenuId,
  onToggleSelected,
  onToggleAll,
  onToggleMenu,
  onEdit,
  onDelete,
}: {
  transactions: Transaction[];
  loading: boolean;
  selectedIds: Set<string>;
  actionMenuId: string | null;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  onToggleMenu: (id: string | null) => void;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (loading) return <EmptyPanel label="Loading transactions" />;
  if (transactions.length === 0) return <EmptyPanel label="No transactions" />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th align="center">
              <input
                type="checkbox"
                checked={selectedIds.size === transactions.length}
                onChange={onToggleAll}
              />
            </Th>
            <Th>Date</Th>
            <Th>Description</Th>
            <Th>Account</Th>
            <Th>Category</Th>
            <Th>Type</Th>
            <Th>Tags</Th>
            <Th align="right">Amount</Th>
            <Th align="right">Action</Th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const tone = transactionTone(transaction.type);
            return (
              <tr key={transaction.id}>
                <Td align="center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(transaction.id)}
                    onChange={() => onToggleSelected(transaction.id)}
                  />
                </Td>
                <Td mono size={10} color="var(--text3)">
                  {formatDateDisplay(transaction.date)}
                </Td>
                <Td>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 220,
                      }}
                    >
                      {transaction.description}
                    </div>
                    {transaction.notes && (
                      <div style={{ color: "var(--text3)", fontSize: 10 }}>
                        {transaction.notes}
                      </div>
                    )}
                  </div>
                </Td>
                <Td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{transaction.account_name}</span>
                    {transaction.transfer_account_name && (
                      <span style={{ color: "var(--text3)", fontSize: 10 }}>
                        to {transaction.transfer_account_name}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  {transaction.splits.length > 0 ? (
                    <Tag>Split {transaction.splits.length}</Tag>
                  ) : (
                    <span>{transaction.category_name ?? "-"}</span>
                  )}
                </Td>
                <Td>
                  <Tag variant={tone.tagVariant}>{typeLabel(transaction.type)}</Tag>
                </Td>
                <Td>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {transaction.tags.length === 0 ? (
                      <span style={{ color: "var(--text3)" }}>-</span>
                    ) : (
                      transaction.tags.slice(0, 3).map((tag) => (
                        <span key={tag} style={tagPillStyle}>
                          #{tag}
                        </span>
                      ))
                    )}
                  </div>
                </Td>
                <Td align="right" mono color={tone.color}>
                  {tone.prefix}
                  {formatMoney(transaction.inr_amount_paise)}
                </Td>
                <Td align="right">
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <button
                      type="button"
                      title="Transaction actions"
                      onClick={() =>
                        onToggleMenu(
                          actionMenuId === transaction.id ? null : transaction.id,
                        )
                      }
                      style={actionButtonStyle}
                    >
                      ...
                    </button>
                    {actionMenuId === transaction.id && (
                      <div style={actionMenuStyle}>
                        <button
                          type="button"
                          style={menuItemStyle}
                          onClick={() => onEdit(transaction)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          style={{ ...menuItemStyle, color: "var(--red)" }}
                          onClick={() => onDelete(transaction)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionsSidebar({
  accounts,
  categories,
  transactions,
  onAdd,
}: {
  accounts: Account[];
  categories: FlatCategory[];
  transactions: Transaction[];
  onAdd: () => void;
}) {
  const topCategories = categorySpend(transactions);

  return (
    <aside
      style={{
        background: "var(--bg2)",
        borderLeft: "1px solid var(--border)",
        minWidth: 0,
      }}
    >
      <SectionHeader>Ledger Tools</SectionHeader>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <Button onClick={onAdd} style={{ width: "100%" }}>
          + Add Transaction
        </Button>

        <PanelBlock title="Loaded Rows">
          <div style={bigMonoStyle}>{transactions.length}</div>
        </PanelBlock>

        <PanelBlock title="Accounts In Scope">
          <div style={sidebarListStyle}>
            {accounts.slice(0, 8).map((account) => (
              <div key={account.id} style={sidebarRowStyle}>
                <span>{account.name}</span>
                <span style={{ color: "var(--text3)" }}>{account.currency}</span>
              </div>
            ))}
            {accounts.length === 0 && <span style={mutedTextStyle}>No accounts</span>}
          </div>
        </PanelBlock>

        <PanelBlock title="Top Spend Categories">
          <div style={sidebarListStyle}>
            {topCategories.length === 0 ? (
              <span style={mutedTextStyle}>No expense rows loaded</span>
            ) : (
              topCategories.map(([name, total]) => (
                <div key={name} style={sidebarRowStyle}>
                  <span>{name}</span>
                  <span style={{ color: "var(--red)", fontFamily: "var(--font-mono)" }}>
                    {formatMoney(total, "INR", true)}
                  </span>
                </div>
              ))
            )}
          </div>
        </PanelBlock>

        <PanelBlock title="Categories">
          <div style={sidebarListStyle}>
            {categories.slice(0, 10).map((category) => (
              <div key={category.id} style={sidebarRowStyle}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      background: category.color_hex,
                      display: "inline-block",
                    }}
                  />
                  {categoryLabel(category)}
                </span>
                <span style={{ color: "var(--text3)" }}>{category.type}</span>
              </div>
            ))}
          </div>
        </PanelBlock>
      </div>
    </aside>
  );
}

function TransactionModal({
  form,
  editingTransaction,
  accounts,
  categories,
  instruments,
  latestFxRates,
  error,
  saving,
  onClose,
  onSubmit,
  onChange,
}: {
  form: TransactionFormState;
  editingTransaction: Transaction | null;
  accounts: Account[];
  categories: FlatCategory[];
  instruments: Instrument[];
  latestFxRates: LatestFxRate[];
  error: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  onChange: (form: TransactionFormState) => void;
}) {
  const update = <K extends keyof TransactionFormState>(
    key: K,
    value: TransactionFormState[K],
  ) => onChange({ ...form, [key]: value });
  const expectedCategoryType = categoryTypeForTransaction(form.type);
  const availableCategories = expectedCategoryType
    ? categories.filter((category) => category.type === expectedCategoryType)
    : [];
  const canSplit = form.type === "income" || form.type === "expense";
  const needsDestination = requiresDestination(form.type);
  const showInvestmentFields = isInvestmentType(form.type);
  const needsInvestmentDetail = requiresInvestmentDetail(form.type);
  const sourceAccount = accounts.find((account) => account.id === form.accountId) ?? null;
  const destinationAccount =
    accounts.find((account) => account.id === form.transferAccountId) ?? null;
  const isCrossCurrencyTransfer =
    form.type === "transfer" &&
    sourceAccount !== null &&
    destinationAccount !== null &&
    sourceAccount.currency !== destinationAccount.currency;
  const latestFxRate = useMemo(
    () =>
      sourceAccount && destinationAccount
        ? findLatestFxRate(
            latestFxRates,
            sourceAccount.currency,
            destinationAccount.currency,
          )
        : null,
    [destinationAccount, latestFxRates, sourceAccount],
  );
  const computedDestinationAmount = useMemo(() => {
    if (!isCrossCurrencyTransfer || !form.amount.trim() || !form.fxRate.trim()) {
      return null;
    }
    try {
      return Math.round(parseMoneyInput(form.amount) * parseRateInput(form.fxRate));
    } catch {
      return null;
    }
  }, [form.amount, form.fxRate, isCrossCurrencyTransfer]);

  useEffect(() => {
    if (isCrossCurrencyTransfer && !form.fxRate.trim() && latestFxRate) {
      onChange({ ...form, fxRate: formatRateInput(latestFxRate.rate) });
    } else if (!isCrossCurrencyTransfer && form.fxRate.trim()) {
      onChange({ ...form, fxRate: "" });
    }
  }, [form, isCrossCurrencyTransfer, latestFxRate, onChange]);

  // For investment_buy/sell: compute total from qty × price ± fees so user sees it
  const computedTotal = useMemo(() => {
    if (!needsInvestmentDetail || !form.quantity || !form.pricePerUnit) return null;
    try {
      const qty = parseFloat(form.quantity);
      const price = parseMoneyInput(form.pricePerUnit);
      const fees = form.fees.trim() ? parseMoneyInput(form.fees) : 0;
      if (isNaN(qty) || qty <= 0 || price <= 0) return null;
      const gross = Math.round(qty * price);
      return form.type === "investment_buy" ? gross + fees : Math.max(0, gross - fees);
    } catch {
      return null;
    }
  }, [needsInvestmentDetail, form.type, form.quantity, form.pricePerUnit, form.fees]);

  const updateType = (type: TransactionType) => {
    const nextCategoryType = categoryTypeForTransaction(type);
    const nextCategories = nextCategoryType
      ? categories.filter((category) => category.type === nextCategoryType)
      : [];
    const canKeepCategory =
      nextCategoryType &&
      nextCategories.some((category) => category.id === form.categoryId);
    const canKeepSplits =
      canSplitType(type) &&
      form.splitMode &&
      form.splits.every((split) =>
        nextCategories.some((category) => category.id === split.categoryId),
      );
    onChange({
      ...form,
      type,
      transferAccountId: requiresDestination(type) ? form.transferAccountId : "",
      categoryId: nextCategoryType
        ? canKeepCategory
          ? form.categoryId
          : nextCategories[0]?.id ?? ""
        : "",
      splitMode: canSplitType(type) ? form.splitMode : false,
      splits: canSplitType(type)
        ? canKeepSplits
          ? form.splits
          : form.splitMode
            ? [blankSplit(nextCategories[0]?.id ?? "")]
            : []
        : [],
      instrumentId: isInvestmentType(type) ? form.instrumentId : "",
      quantity: isInvestmentType(type) ? form.quantity : "",
      pricePerUnit: isInvestmentType(type) ? form.pricePerUnit : "",
      fees: isInvestmentType(type) ? form.fees : "",
      fxRate: type === "transfer" ? form.fxRate : "",
    });
  };

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <form
        style={modalStyle}
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div>{editingTransaction ? "Edit Transaction" : "Add Transaction"}</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            x
          </button>
        </div>

        <div style={{ padding: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "170px 1fr 140px", gap: 10 }}>
            <Select
              label="Type"
              value={form.type}
              onChange={(event) => updateType(event.target.value as TransactionType)}
            >
              {TRANSACTION_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
            <Input
              label="Description"
              value={form.description}
              onChange={(event) => update("description", event.target.value)}
              required
            />
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(event) => update("date", event.target.value)}
              required
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: needsDestination
                ? "1fr 1fr 150px"
                : showInvestmentFields
                  ? "1fr"
                  : "1fr 150px",
              gap: 10,
              marginTop: 10,
            }}
          >
            <Select
              label="Account"
              value={form.accountId}
              onChange={(event) => update("accountId", event.target.value)}
              required
            >
              <option value="">Select account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            {needsDestination && (
              <Select
                label="Destination"
                value={form.transferAccountId}
                onChange={(event) => update("transferAccountId", event.target.value)}
                required
              >
                <option value="">Select destination</option>
                {accounts
                  .filter((account) => account.id !== form.accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </Select>
            )}
            {!showInvestmentFields && (
              <Input
                label="Amount"
                value={form.amount}
                inputMode="decimal"
                onChange={(event) => update("amount", event.target.value)}
                required
              />
            )}
          </div>

          {isCrossCurrencyTransfer && sourceAccount && destinationAccount && (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "var(--bg3)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-cond)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text3)",
                  marginBottom: 8,
                }}
              >
                FX Transfer
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <Input
                  label={`Rate ${sourceAccount.currency}/${destinationAccount.currency}`}
                  value={form.fxRate}
                  inputMode="decimal"
                  onChange={(event) => update("fxRate", event.target.value)}
                  placeholder="83.450000"
                  required
                />
                <div>
                  <div style={metricLabelStyle}>Destination Credit</div>
                  <div
                    style={{
                      marginTop: 5,
                      minHeight: 28,
                      display: "flex",
                      alignItems: "center",
                      background: "var(--bg2)",
                      border: "1px solid var(--border2)",
                      padding: "5px 8px",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color:
                        computedDestinationAmount !== null
                          ? "var(--text)"
                          : "var(--text3)",
                    }}
                  >
                    {computedDestinationAmount !== null
                      ? formatMoney(computedDestinationAmount, destinationAccount.currency)
                      : "--"}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text3)",
                }}
              >
                {latestFxRate
                  ? `Latest ${latestFxRate.sourceLabel}: ${formatRateInput(latestFxRate.rate)} · ${formatDateDisplay(latestFxRate.date)}`
                  : "No saved rate for this pair"}
              </div>
            </div>
          )}

          {showInvestmentFields && (
            <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg3)", border: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "var(--font-cond)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text3)", marginBottom: 8 }}>
                Investment Detail
              </div>
              <Select
                label="Instrument"
                value={form.instrumentId}
                onChange={(event) => update("instrumentId", event.target.value)}
                required={needsInvestmentDetail}
              >
                <option value="">Select instrument</option>
                {instruments.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name}{inst.ticker ? ` (${inst.ticker})` : ""}
                  </option>
                ))}
              </Select>
              {needsInvestmentDetail && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                  <Input
                    label="Quantity"
                    value={form.quantity}
                    inputMode="decimal"
                    onChange={(event) => update("quantity", event.target.value)}
                    placeholder="e.g. 10.5"
                    required
                  />
                  <Input
                    label="Price per unit"
                    value={form.pricePerUnit}
                    inputMode="decimal"
                    onChange={(event) => update("pricePerUnit", event.target.value)}
                    placeholder="e.g. 1500.00"
                    required
                  />
                  <Input
                    label="Fees"
                    value={form.fees}
                    inputMode="decimal"
                    onChange={(event) => update("fees", event.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}
              {!needsInvestmentDetail && (
                <div style={{ marginTop: 10 }}>
                  <Input
                    label="Amount"
                    value={form.amount}
                    inputMode="decimal"
                    onChange={(event) => update("amount", event.target.value)}
                    required
                  />
                </div>
              )}
              {needsInvestmentDetail && computedTotal !== null && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-cond)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text3)" }}>
                    {form.type === "investment_buy" ? "Total debit" : "Net proceeds"}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text)" }}>
                    {paiseToInput(computedTotal)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: expectedCategoryType ? "1fr 1fr" : "1fr",
              gap: 10,
              marginTop: 10,
            }}
          >
            {expectedCategoryType && !form.splitMode && (
              <Select
                label="Category"
                value={form.categoryId}
                onChange={(event) => update("categoryId", event.target.value)}
                required
              >
                <option value="">Select category</option>
                {availableCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </Select>
            )}
            <Input
              label="Tags"
              value={form.tags}
              onChange={(event) => update("tags", event.target.value)}
              placeholder="medical, tax"
            />
          </div>

          {canSplit && (
            <div style={{ marginTop: 10 }}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={form.splitMode}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      splitMode: event.target.checked,
                      categoryId: event.target.checked ? "" : form.categoryId,
                      splits: event.target.checked
                        ? form.splits.length > 0
                          ? form.splits
                          : [blankSplit(availableCategories[0]?.id ?? "")]
                        : [],
                    })
                  }
                />
                Split transaction
              </label>
              {form.splitMode && (
                <SplitEditor
                  splits={form.splits}
                  categories={availableCategories}
                  onChange={(splits) => update("splits", splits)}
                />
              )}
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(event) => update("isRecurring", event.target.checked)}
              />
              Recurring
            </label>
            {form.isRecurring && (
              <div style={{ width: 180, marginTop: 6 }}>
                <Select
                  label="Frequency"
                  value={form.recurrenceFrequency}
                  onChange={(event) =>
                    update(
                      "recurrenceFrequency",
                      event.target.value as RecurrenceFrequency,
                    )
                  }
                >
                  {RECURRENCE_OPTIONS.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency}
                    </option>
                  ))}
                </Select>
              </div>
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
            <div style={{ ...noticeStyle("error"), marginTop: 10 }}>{error}</div>
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
                : editingTransaction
                  ? "Save Transaction"
                  : "Create Transaction"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function SplitEditor({
  splits,
  categories,
  onChange,
}: {
  splits: SplitFormState[];
  categories: FlatCategory[];
  onChange: (splits: SplitFormState[]) => void;
}) {
  const updateSplit = <K extends keyof SplitFormState>(
    index: number,
    key: K,
    value: SplitFormState[K],
  ) => {
    onChange(
      splits.map((split, currentIndex) =>
        currentIndex === index ? { ...split, [key]: value } : split,
      ),
    );
  };

  return (
    <div style={splitBoxStyle}>
      {splits.map((split, index) => (
        <div
          key={index}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 120px 1fr 28px",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Select
            label={index === 0 ? "Split Category" : undefined}
            value={split.categoryId}
            onChange={(event) => updateSplit(index, "categoryId", event.target.value)}
          >
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category)}
              </option>
            ))}
          </Select>
          <Input
            label={index === 0 ? "Amount" : undefined}
            value={split.amount}
            inputMode="decimal"
            onChange={(event) => updateSplit(index, "amount", event.target.value)}
          />
          <Input
            label={index === 0 ? "Notes" : undefined}
            value={split.notes}
            onChange={(event) => updateSplit(index, "notes", event.target.value)}
          />
          <button
            type="button"
            style={{ ...smallIconButtonStyle, alignSelf: "end" }}
            onClick={() => onChange(splits.filter((_, currentIndex) => currentIndex !== index))}
          >
            x
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...splits, blankSplit(categories[0]?.id ?? "")])}
      >
        + Add Split
      </Button>
    </div>
  );
}

function buildTransactionPayload(
  form: TransactionFormState,
  accounts: Account[],
): TransactionPayload {
  const description = form.description.trim();
  if (!description) throw new Error("Description is required");
  if (!form.accountId) throw new Error("Account is required");
  if (requiresDestination(form.type) && !form.transferAccountId) {
    throw new Error("Destination account is required");
  }

  // For investment_buy / investment_sell, derive amount from qty × price ± fees
  const needsInvestmentDetail = requiresInvestmentDetail(form.type);
  let amount: number;
  let investmentFields: Partial<TransactionPayload> = {};
  let fxFields: Partial<TransactionPayload> = {};

  if (needsInvestmentDetail) {
    if (!form.instrumentId) throw new Error("Instrument is required");
    const qty = parseFloat(form.quantity);
    if (!form.quantity || isNaN(qty) || qty <= 0) {
      throw new Error("Quantity must be a positive number");
    }
    const pricePerUnit = parseMoneyInput(form.pricePerUnit);
    if (pricePerUnit <= 0) throw new Error("Price per unit must be positive");
    const fees = form.fees.trim() ? parseMoneyInput(form.fees) : 0;
    const gross = Math.round(qty * pricePerUnit);
    amount = form.type === "investment_buy" ? gross + fees : gross - fees;
    if (amount <= 0) throw new Error("Net transaction amount must be positive");
    investmentFields = {
      instrument_id: form.instrumentId,
      quantity: qty,
      price_per_unit_paise: pricePerUnit,
      fees_paise: fees,
    };
  } else if (isInvestmentType(form.type) && form.instrumentId) {
    // dividend: optional instrument link
    investmentFields = { instrument_id: form.instrumentId };
    amount = parseMoneyInput(form.amount);
    if (amount <= 0) throw new Error("Amount must be positive");
  } else {
    amount = parseMoneyInput(form.amount);
    if (amount <= 0) throw new Error("Amount must be positive");
  }

  if (form.type === "transfer") {
    const sourceAccount = accounts.find((account) => account.id === form.accountId);
    const destinationAccount = accounts.find(
      (account) => account.id === form.transferAccountId,
    );
    if (sourceAccount && destinationAccount && sourceAccount.currency !== destinationAccount.currency) {
      const rate = parseRateInput(form.fxRate);
      const toAmount = Math.round(amount * rate);
      if (toAmount <= 0) {
        throw new Error("Converted destination amount must be positive");
      }
      fxFields = {
        fx_rate: rate,
        fx_to_amount_paise: toAmount,
        fx_fee_paise: 0,
      };
    }
  }

  const categoryType = categoryTypeForTransaction(form.type);
  const splitMode = form.splitMode && canSplitType(form.type);
  const splits = splitMode
    ? form.splits.map((split) => ({
        category_id: split.categoryId,
        amount_paise: parseMoneyInput(split.amount),
        notes: split.notes.trim() ? split.notes.trim() : null,
      }))
    : [];

  if (splitMode) {
    const total = splits.reduce((sum, split) => sum + split.amount_paise, 0);
    if (splits.length === 0) throw new Error("Add at least one split");
    if (splits.some((split) => !split.category_id)) {
      throw new Error("Every split needs a category");
    }
    if (total !== amount) {
      throw new Error("Split amounts must equal the transaction amount");
    }
  } else if (categoryType && !form.categoryId) {
    throw new Error("Category is required");
  }
  if (splits.some((split) => split.amount_paise <= 0)) {
    throw new Error("Split amounts must be positive");
  }

  return {
    account_id: form.accountId,
    transfer_account_id: requiresDestination(form.type)
      ? form.transferAccountId
      : null,
    type: form.type,
    date: form.date,
    description,
    amount_paise: amount,
    category_id: splitMode ? null : categoryType ? form.categoryId : null,
    notes: form.notes.trim() ? form.notes.trim() : null,
    tags: parseTags(form.tags),
    splits,
    is_recurring: form.isRecurring,
    recurrence_frequency: form.isRecurring ? form.recurrenceFrequency : null,
    ...fxFields,
    ...investmentFields,
  };
}

function buildApiFilters(filters: FilterState, cursor?: string): TransactionFilters {
  return {
    cursor,
    limit: 50,
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
    account_id: filters.accountId || undefined,
    category_id: filters.categoryId || undefined,
    type: filters.type === "all" ? undefined : filters.type,
    tag: filters.tag.trim() || undefined,
    search: filters.search.trim() || undefined,
    amount_min: filters.amountMin.trim()
      ? parseMoneyInput(filters.amountMin)
      : undefined,
    amount_max: filters.amountMax.trim()
      ? parseMoneyInput(filters.amountMax)
      : undefined,
    sort: "date_desc",
  };
}

function blankForm(
  accounts: Account[],
  categories: FlatCategory[],
): TransactionFormState {
  const expenseCategory = categories.find((category) => category.type === "expense");
  return {
    type: "expense",
    date: todayInputDate(),
    accountId: accounts[0]?.id ?? "",
    transferAccountId: "",
    categoryId: expenseCategory?.id ?? "",
    amount: "",
    description: "",
    tags: "",
    notes: "",
    isRecurring: false,
    recurrenceFrequency: "monthly",
    splitMode: false,
    splits: [],
    instrumentId: "",
    quantity: "",
    pricePerUnit: "",
    fees: "",
    fxRate: "",
  };
}

function formFromTransaction(transaction: Transaction): TransactionFormState {
  const detail = transaction.investment_detail;
  return {
    type: transaction.type,
    date: transaction.date,
    accountId: transaction.account_id,
    transferAccountId: transaction.transfer_account_id ?? "",
    categoryId: transaction.category_id ?? "",
    amount: paiseToInput(transaction.amount_paise),
    description: transaction.description,
    tags: transaction.tags.join(", "),
    notes: transaction.notes ?? "",
    isRecurring: transaction.is_recurring,
    recurrenceFrequency: transaction.recurrence_frequency ?? "monthly",
    splitMode: transaction.splits.length > 0,
    splits: transaction.splits.map((split) => ({
      categoryId: split.category_id ?? "",
      amount: paiseToInput(split.amount_paise),
      notes: split.notes ?? "",
    })),
    instrumentId: detail?.instrument_id ?? "",
    quantity: detail ? String(detail.quantity) : "",
    pricePerUnit: detail ? paiseToInput(detail.price_per_unit_paise) : "",
    fees: detail ? paiseToInput(detail.fees_paise) : "",
    fxRate: transaction.fx_rate ? formatRateInput(transaction.fx_rate) : "",
  };
}

function flattenCategories(categories: CategoryNode[], level = 0): FlatCategory[] {
  return categories.flatMap((category) => [
    {
      id: category.id,
      name: category.name,
      type: category.type,
      color_hex: category.color_hex,
      level,
    },
    ...flattenCategories(category.children, level + 1),
  ]);
}

function categorySpend(transactions: Transaction[]): Array<[string, number]> {
  const totals = new Map<string, number>();
  transactions
    .filter((transaction) => transaction.type === "expense")
    .forEach((transaction) => {
      if (transaction.splits.length > 0) {
        transaction.splits.forEach((split) => {
          const key = split.category_name ?? "Split";
          totals.set(key, (totals.get(key) ?? 0) + split.inr_amount_paise);
        });
      } else {
        const key = transaction.category_name ?? "Uncategorized";
        totals.set(key, (totals.get(key) ?? 0) + transaction.inr_amount_paise);
      }
    });

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

function defaultFilters(): FilterState {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    search: "",
    dateFrom: toInputDate(start),
    dateTo: toInputDate(end),
    accountId: "",
    categoryId: "",
    type: "all",
    tag: "",
    amountMin: "",
    amountMax: "",
  };
}

function blankSplit(categoryId: string): SplitFormState {
  return { categoryId, amount: "", notes: "" };
}

function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean),
    ),
  );
}

interface FxRateMatch {
  rate: number;
  date: string;
  sourceLabel: string;
}

function findLatestFxRate(
  rates: LatestFxRate[],
  fromCurrency: string,
  toCurrency: string,
): FxRateMatch | null {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  const direct = rates.find(
    (rate) => rate.from_currency === from && rate.to_currency === to,
  );
  if (direct) {
    return {
      rate: direct.rate,
      date: direct.date,
      sourceLabel: `${from}/${to}`,
    };
  }

  const reverse = rates.find(
    (rate) => rate.from_currency === to && rate.to_currency === from,
  );
  if (!reverse) return null;
  return {
    rate: 1 / reverse.rate,
    date: reverse.date,
    sourceLabel: `${to}/${from} inverted`,
  };
}

function parseRateInput(value: string): number {
  const rate = Number(value.trim().replace(/,/g, ""));
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("FX rate must be a positive number");
  }
  return rate;
}

function formatRateInput(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function categoryTypeForTransaction(type: TransactionType): CategoryType | null {
  if (type === "income" || type === "dividend") return "income";
  if (type === "expense") return "expense";
  return null;
}

function canSplitType(type: TransactionType) {
  return type === "income" || type === "expense";
}

function requiresDestination(type: TransactionType) {
  return type === "transfer" || type === "loan_repayment" || type === "credit_card_payment";
}

function isInvestmentType(type: TransactionType) {
  return type === "investment_buy" || type === "investment_sell" || type === "dividend";
}

function requiresInvestmentDetail(type: TransactionType) {
  return type === "investment_buy" || type === "investment_sell";
}

function typeLabel(type: TransactionType) {
  return TRANSACTION_TYPES.find((item) => item.value === type)?.label ?? type;
}

function transactionTone(type: TransactionType) {
  if (type === "income" || type === "dividend" || type === "investment_sell") {
    return { color: "var(--green)", prefix: "+", tagVariant: "income" as const };
  }
  if (type === "transfer" || type === "valuation_update") {
    return { color: "var(--text2)", prefix: "", tagVariant: "transfer" as const };
  }
  return { color: "var(--red)", prefix: "-", tagVariant: "expense" as const };
}

function categoryLabel(category: FlatCategory) {
  return `${category.level > 0 ? "  ".repeat(category.level) : ""}${category.name}`;
}

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayInputDate() {
  return toInputDate(new Date());
}

function MetricLabel({ children }: { children: string }) {
  return <div style={metricLabelStyle}>{children}</div>;
}

function SectionHeader({ children }: { children: string }) {
  return <div style={sectionHeaderStyle}>{children}</div>;
}

function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <SectionHeader>{title}</SectionHeader>
      <div style={{ paddingTop: 8 }}>{children}</div>
    </div>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: 280,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text3)",
        fontFamily: "var(--font-cond)",
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
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
  align?: "left" | "right" | "center";
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

const metricLabelStyle: CSSProperties = {
  fontSize: 9,
  fontFamily: "var(--font-cond)",
  fontWeight: 500,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
};

const sectionHeaderStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text3)",
  padding: "0 0 4px",
};

const mutedCapsStyle: CSSProperties = {
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text3)",
};

const mutedTextStyle: CSSProperties = {
  color: "var(--text3)",
  fontSize: 11,
};

const bigMonoStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 28,
  lineHeight: 1,
  color: "var(--text)",
};

const sidebarListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 11,
};

const sidebarRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  color: "var(--text2)",
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

const smallIconButtonStyle: CSSProperties = {
  height: 24,
  minWidth: 30,
  border: "1px solid var(--border2)",
  background: "none",
  color: "var(--text2)",
  cursor: "pointer",
  fontFamily: "var(--font-cond)",
  fontSize: 9,
  textTransform: "uppercase",
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
  width: 760,
  maxWidth: "100%",
  maxHeight: "92vh",
  overflowY: "auto",
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
  fontSize: 18,
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

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "var(--font-cond)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text3)",
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

const splitBoxStyle: CSSProperties = {
  marginTop: 8,
  padding: 10,
  background: "var(--bg3)",
  border: "1px solid var(--border)",
};

const tagPillStyle: CSSProperties = {
  border: "1px solid var(--border2)",
  color: "var(--text3)",
  padding: "1px 4px",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
};
