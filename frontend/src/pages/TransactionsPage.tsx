import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { getAccounts } from "../api/accounts";
import { getCategories } from "../api/categories";
import {
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
}

interface SplitFormState {
  categoryId: string;
  amount: string;
  notes: string;
}

export default function TransactionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary>(EMPTY_SUMMARY);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [draftFilters, setDraftFilters] = useState<FilterState>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(defaultFilters);
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

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [accountResponse, categoryResponse] = await Promise.all([
        getAccounts(),
        getCategories(),
      ]);
      setAccounts(
        [...accountResponse.asset_groups, ...accountResponse.liability_groups]
          .flatMap((group) => group.accounts)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCategories(categoryResponse.categories);
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
      const payload = buildTransactionPayload(form);
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

function FilterBar({
  filters,
  accounts,
  categories,
  onChange,
  onApply,
  onReset,
  onExport,
  onAdd,
}: {
  filters: FilterState;
  accounts: Account[];
  categories: FlatCategory[];
  onChange: (filters: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  onAdd: () => void;
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
                  {formatMoney(transaction.amount_paise)}
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
              gridTemplateColumns: needsDestination ? "1fr 1fr 150px" : "1fr 150px",
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
            <Input
              label="Amount"
              value={form.amount}
              inputMode="decimal"
              onChange={(event) => update("amount", event.target.value)}
              required
            />
          </div>

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

function buildTransactionPayload(form: TransactionFormState): TransactionPayload {
  const amount = parseMoneyInput(form.amount);
  const description = form.description.trim();
  if (amount <= 0) throw new Error("Amount must be positive");
  if (!description) throw new Error("Description is required");
  if (!form.accountId) throw new Error("Account is required");
  if (requiresDestination(form.type) && !form.transferAccountId) {
    throw new Error("Destination account is required");
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
  };
}

function formFromTransaction(transaction: Transaction): TransactionFormState {
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
      categoryId: split.category_id,
      amount: paiseToInput(split.amount_paise),
      notes: split.notes ?? "",
    })),
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
          totals.set(key, (totals.get(key) ?? 0) + split.amount_paise);
        });
      } else {
        const key = transaction.category_name ?? "Uncategorized";
        totals.set(key, (totals.get(key) ?? 0) + transaction.amount_paise);
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
