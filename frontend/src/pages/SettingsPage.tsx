import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { archiveCategory, createCategory, getCategories, updateCategory } from '../api/categories';
import { archiveInstrument, createInstrument, getInstruments, updateInstrument } from '../api/instruments';
import Button from '../components/Button';
import Input from '../components/Input';
import Select from '../components/Select';
import { useAuth } from '../contexts/AuthContext';
import type { CategoryNode, CategoryPayload, CategoryType } from '../types/category';
import type { CreateInstrumentPayload, Instrument, InstrumentType } from '../types/instrument';

type SettingsView = 'overview' | 'categories' | 'instruments';

interface FlatCategory {
  id: string;
  name: string;
  type: CategoryType;
  color_hex: string;
  icon_emoji: string | null;
  parent_id: string | null;
  level: number;
  is_default: boolean;
}

interface CategoryFormState {
  name: string;
  type: CategoryType;
  parent_id: string;
  color_hex: string;
  icon_emoji: string;
}

interface InstrumentFormState {
  name: string;
  type: InstrumentType;
  ticker: string;
  currency: string;
  sector: string;
  geography: string;
  notes: string;
}

const SETTING_TILES: Array<{
  key: SettingsView | 'placeholder';
  label: string;
  description: string;
  accent: string;
  disabled?: boolean;
}> = [
  {
    key: 'categories',
    label: 'Categories',
    description: 'Manage income and expense taxonomy',
    accent: 'var(--accent)',
  },
  {
    key: 'instruments',
    label: 'Instruments',
    description: 'Maintain investment masters and metadata',
    accent: 'var(--blue)',
  },
  {
    key: 'placeholder',
    label: 'Sessions',
    description: 'Login sessions and device controls',
    accent: 'var(--text3)',
    disabled: true,
  },
  {
    key: 'placeholder',
    label: 'Exports',
    description: 'Backups, export bundles, and retention',
    accent: 'var(--text3)',
    disabled: true,
  },
  {
    key: 'placeholder',
    label: 'Preferences',
    description: 'Display, density, and privacy defaults',
    accent: 'var(--text3)',
    disabled: true,
  },
  {
    key: 'placeholder',
    label: 'Integrations',
    description: 'External price and statement sources',
    accent: 'var(--text3)',
    disabled: true,
  },
];

const INSTRUMENT_TYPES: Array<{ value: InstrumentType; label: string }> = [
  { value: 'equity', label: 'Equity' },
  { value: 'mf', label: 'Mutual Fund' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: 'Bond' },
  { value: 'gold', label: 'Gold' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
];

export default function SettingsPage() {
  const { user } = useAuth();

  const [view, setView] = useState<SettingsView>('overview');
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FlatCategory | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(blankCategoryForm());
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState('');

  const [instrumentModalOpen, setInstrumentModalOpen] = useState(false);
  const [editingInstrument, setEditingInstrument] = useState<Instrument | null>(null);
  const [instrumentForm, setInstrumentForm] = useState<InstrumentFormState>(blankInstrumentForm());
  const [instrumentSaving, setInstrumentSaving] = useState(false);
  const [instrumentError, setInstrumentError] = useState('');

  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [categoryResponse, instrumentResponse] = await Promise.all([
        getCategories(),
        getInstruments(),
      ]);
      setCategories(categoryResponse.categories);
      setInstruments(
        [...instrumentResponse.instruments].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings');
    } finally {
      setLoading(false);
    }
  }

  const categoryParentOptions = useMemo(() => {
    const type = categoryForm.type;
    return flatCategories.filter((category) => {
      if (category.type !== type) return false;
      if (!editingCategory) return true;
      return category.id !== editingCategory.id;
    });
  }, [categoryForm.type, editingCategory, flatCategories]);

  const categorySummary = useMemo(() => {
    const income = flatCategories.filter((category) => category.type === 'income').length;
    const expense = flatCategories.filter((category) => category.type === 'expense').length;
    return { income, expense, total: flatCategories.length };
  }, [flatCategories]);

  const categoriesByType = useMemo(
    () => ({
      income: flatCategories.filter((category) => category.type === 'income'),
      expense: flatCategories.filter((category) => category.type === 'expense'),
    }),
    [flatCategories],
  );

  const groupedInstruments = useMemo(() => {
    const groups = new Map<InstrumentType, Instrument[]>();
    for (const instrument of instruments) {
      const current = groups.get(instrument.type) ?? [];
      current.push(instrument);
      groups.set(instrument.type, current);
    }

    return Array.from(groups.entries()).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return instrumentTypeLabel(a[0]).localeCompare(instrumentTypeLabel(b[0]));
    });
  }, [instruments]);

  function openCategoryCreate() {
    setEditingCategory(null);
    setCategoryForm(blankCategoryForm());
    setCategoryError('');
    setCategoryModalOpen(true);
  }

  function openCategoryEdit(category: FlatCategory) {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name,
      type: category.type,
      parent_id: category.parent_id ?? '',
      color_hex: category.color_hex,
      icon_emoji: category.icon_emoji ?? '',
    });
    setCategoryError('');
    setCategoryModalOpen(true);
  }

  function closeCategoryModal() {
    if (categorySaving) return;
    setCategoryModalOpen(false);
    setEditingCategory(null);
    setCategoryError('');
  }

  async function handleCategorySubmit(event: FormEvent) {
    event.preventDefault();
    const name = categoryForm.name.trim();
    const color_hex = categoryForm.color_hex.trim().toUpperCase();
    if (!name) {
      setCategoryError('Category name is required');
      return;
    }
    if (!/^#[0-9A-F]{6}$/.test(color_hex)) {
      setCategoryError('Color must be a hex value like #3A7FFF');
      return;
    }

    setCategorySaving(true);
    setCategoryError('');
    try {
      const payload: CategoryPayload = {
        name,
        type: categoryForm.type,
        parent_id: categoryForm.parent_id || null,
        color_hex,
        icon_emoji: categoryForm.icon_emoji.trim() || null,
      };

      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: payload.name,
          parent_id: payload.parent_id,
          color_hex: payload.color_hex,
          icon_emoji: payload.icon_emoji,
        });
      } else {
        await createCategory(payload);
      }

      setCategoryModalOpen(false);
      setEditingCategory(null);
      setCategoryError('');
      await loadData();
      setView('categories');
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : 'Unable to save category');
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleCategoryDelete(category: FlatCategory) {
    const confirmed = window.confirm(
      `Archive "${category.name}"? Related transactions will become uncategorised.`,
    );
    if (!confirmed) return;

    try {
      await archiveCategory(category.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive category');
    }
  }

  function openInstrumentCreate() {
    setEditingInstrument(null);
    setInstrumentForm(blankInstrumentForm());
    setInstrumentError('');
    setInstrumentModalOpen(true);
  }

  function openInstrumentEdit(instrument: Instrument) {
    setEditingInstrument(instrument);
    setInstrumentForm({
      name: instrument.name,
      type: instrument.type,
      ticker: instrument.ticker ?? '',
      currency: instrument.currency,
      sector: instrument.sector ?? '',
      geography: instrument.geography ?? '',
      notes: instrument.notes ?? '',
    });
    setInstrumentError('');
    setInstrumentModalOpen(true);
  }

  function closeInstrumentModal() {
    if (instrumentSaving) return;
    setInstrumentModalOpen(false);
    setEditingInstrument(null);
    setInstrumentError('');
  }

  async function handleInstrumentSubmit(event: FormEvent) {
    event.preventDefault();
    const name = instrumentForm.name.trim();
    if (!name) {
      setInstrumentError('Instrument name is required');
      return;
    }

    setInstrumentSaving(true);
    setInstrumentError('');
    try {
      const payload: CreateInstrumentPayload = {
        name,
        type: instrumentForm.type,
        ticker: instrumentForm.ticker.trim() || null,
        currency: instrumentForm.currency.trim().toUpperCase() || 'INR',
        sector: instrumentForm.sector.trim() || null,
        geography: instrumentForm.geography.trim() || null,
        notes: instrumentForm.notes.trim() || null,
      };

      if (editingInstrument) {
        await updateInstrument(editingInstrument.id, payload);
      } else {
        await createInstrument(payload);
      }

      setInstrumentModalOpen(false);
      setEditingInstrument(null);
      setInstrumentError('');
      await loadData();
      setView('instruments');
    } catch (err) {
      setInstrumentError(err instanceof Error ? err.message : 'Unable to save instrument');
    } finally {
      setInstrumentSaving(false);
    }
  }

  async function handleInstrumentDelete(instrument: Instrument) {
    const confirmed = window.confirm(
      `Archive "${instrument.name}"? Instruments with active holdings cannot be deleted.`,
    );
    if (!confirmed) return;

    try {
      await archiveInstrument(instrument.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive instrument');
    }
  }

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>System Settings</div>
          <h1 style={titleStyle}>Identity, taxonomy, and investment masters</h1>
        </div>
        {view !== 'overview' && (
          <Button variant="ghost" onClick={() => setView('overview')}>
            Back To Overview
          </Button>
        )}
      </div>

      {error && (
        <div style={errorBannerStyle}>
          <span>{error}</span>
          <button type="button" style={inlineActionButtonStyle} onClick={() => void loadData()}>
            Retry
          </button>
        </div>
      )}

      <div style={layoutStyle}>
        <section style={profileCardStyle}>
          <div style={sectionHeaderStyle}>Primary User</div>
          <div style={profileBodyStyle}>
            <div style={avatarStyle}>{user?.avatar_initials ?? '??'}</div>
            <div style={profileMetaStyle}>
              <div style={profileNameStyle}>{user?.display_name ?? '--'}</div>
              <div style={profileEmailStyle}>{user?.email ?? '--'}</div>
            </div>
          </div>
          <div style={profileFactsGridStyle}>
            <MetricCell label="User Id" value={user?.id ?? '--'} mono />
            <MetricCell label="Categories" value={String(categorySummary.total)} mono />
            <MetricCell label="Income" value={String(categorySummary.income)} mono />
            <MetricCell label="Expense" value={String(categorySummary.expense)} mono />
            <MetricCell label="Instruments" value={String(instruments.length)} mono />
            <MetricCell label="Status" value="Active" tone="var(--green)" />
          </div>
        </section>

        <section style={mainPanelStyle}>
          {view === 'overview' ? (
            <>
              <div style={sectionHeaderStyle}>Settings Grid</div>
              <div style={tileGridStyle}>
                {SETTING_TILES.map((tile, index) => {
                  const active = tile.key === view;
                  const actionable = !tile.disabled && tile.key !== 'placeholder';
                  return (
                    <button
                      key={`${tile.label}-${index}`}
                      type="button"
                      disabled={!actionable}
                      onClick={() => actionable && setView(tile.key as SettingsView)}
                      style={{
                        ...tileStyle,
                        cursor: actionable ? 'pointer' : 'default',
                        opacity: actionable ? 1 : 0.6,
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                      }}
                    >
                      <div style={{ ...tileBarStyle, background: tile.accent }} />
                      <div style={tileLabelStyle}>{tile.label}</div>
                      <div style={tileDescriptionStyle}>{tile.description}</div>
                      <div style={tileFootStyle}>
                        {actionable ? 'Open' : 'Coming Soon'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {view === 'categories' ? (
            <>
              <div style={sectionHeaderStyle}>
                <span>Categories</span>
                <Button size="sm" onClick={openCategoryCreate}>
                  + Add Category
                </Button>
              </div>
              <div style={subtleNoteStyle}>
                Archiving a category leaves related transactions uncategorised.
              </div>
              <div style={contentPadStyle}>
                <div style={summaryStripStyle}>
                  <MetricPill label="Total Categories" value={String(categorySummary.total)} tone="var(--text)" />
                  <MetricPill label="Expense Tree" value={String(categorySummary.expense)} tone="var(--accent)" />
                  <MetricPill label="Income Tree" value={String(categorySummary.income)} tone="var(--green)" />
                </div>

                {loading ? (
                  <div style={emptyStatePanelStyle}>Loading categories...</div>
                ) : flatCategories.length === 0 ? (
                  <div style={emptyStatePanelStyle}>No categories found.</div>
                ) : (
                  <div style={splitPanelGridStyle}>
                    <CategoryGroupPanel
                      title="Expense Categories"
                      accent="var(--accent)"
                      categories={categoriesByType.expense}
                      allCategories={flatCategories}
                      onEdit={openCategoryEdit}
                      onDelete={handleCategoryDelete}
                    />
                    <CategoryGroupPanel
                      title="Income Categories"
                      accent="var(--green)"
                      categories={categoriesByType.income}
                      allCategories={flatCategories}
                      onEdit={openCategoryEdit}
                      onDelete={handleCategoryDelete}
                    />
                  </div>
                )}
              </div>
            </>
          ) : null}

          {view === 'instruments' ? (
            <>
              <div style={sectionHeaderStyle}>
                <span>Instruments</span>
                <Button size="sm" onClick={openInstrumentCreate}>
                  + Add Instrument
                </Button>
              </div>
              <div style={subtleNoteStyle}>
                Instruments with active holdings cannot be archived.
              </div>
              <div style={contentPadStyle}>
                <div style={summaryStripStyle}>
                  <MetricPill label="Total Instruments" value={String(instruments.length)} tone="var(--text)" />
                  <MetricPill label="Active Types" value={String(groupedInstruments.length)} tone="var(--blue)" />
                </div>

                {loading ? (
                  <div style={emptyStatePanelStyle}>Loading instruments...</div>
                ) : instruments.length === 0 ? (
                  <div style={emptyStatePanelStyle}>No instruments found.</div>
                ) : (
                  <div style={instrumentPanelGridStyle}>
                    {groupedInstruments.map(([type, items]) => (
                      <InstrumentGroupPanel
                        key={type}
                        type={type}
                        instruments={items}
                        onEdit={openInstrumentEdit}
                        onDelete={handleInstrumentDelete}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>
      </div>

      {categoryModalOpen ? (
        <div style={modalBackdropStyle} onMouseDown={closeCategoryModal}>
          <form style={modalStyle} onSubmit={handleCategorySubmit} onMouseDown={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={eyebrowStyle}>{editingCategory ? 'Edit Category' : 'New Category'}</div>
                <div style={modalTitleStyle}>
                  {editingCategory ? editingCategory.name : 'Create category'}
                </div>
              </div>
              <button type="button" style={modalCloseButtonStyle} onClick={closeCategoryModal}>
                ×
              </button>
            </div>

            <div style={formGridStyle}>
              <Input
                label="Name"
                value={categoryForm.name}
                onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Select
                label="Type"
                value={categoryForm.type}
                disabled={Boolean(editingCategory)}
                onChange={(event) =>
                  setCategoryForm((current) => ({
                    ...current,
                    type: event.target.value as CategoryType,
                    parent_id: '',
                  }))
                }
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </Select>
              <Select
                label="Parent"
                value={categoryForm.parent_id}
                onChange={(event) => setCategoryForm((current) => ({ ...current, parent_id: event.target.value }))}
              >
                <option value="">No parent</option>
                {categoryParentOptions.map((category) => (
                  <option key={category.id} value={category.id}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </Select>
              <Input
                label="Color"
                value={categoryForm.color_hex}
                onChange={(event) =>
                  setCategoryForm((current) => ({ ...current, color_hex: event.target.value }))
                }
              />
              <Input
                label="Icon"
                value={categoryForm.icon_emoji}
                onChange={(event) =>
                  setCategoryForm((current) => ({ ...current, icon_emoji: event.target.value }))
                }
              />
            </div>

            {categoryError ? <div style={modalErrorStyle}>{categoryError}</div> : null}

            <div style={modalFooterStyle}>
              <Button type="button" variant="ghost" onClick={closeCategoryModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={categorySaving}>
                {categorySaving ? 'Saving...' : editingCategory ? 'Update Category' : 'Create Category'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {instrumentModalOpen ? (
        <div style={modalBackdropStyle} onMouseDown={closeInstrumentModal}>
          <form style={{ ...modalStyle, maxWidth: 720 }} onSubmit={handleInstrumentSubmit} onMouseDown={(event) => event.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <div>
                <div style={eyebrowStyle}>{editingInstrument ? 'Edit Instrument' : 'New Instrument'}</div>
                <div style={modalTitleStyle}>
                  {editingInstrument ? editingInstrument.name : 'Create instrument'}
                </div>
              </div>
              <button type="button" style={modalCloseButtonStyle} onClick={closeInstrumentModal}>
                ×
              </button>
            </div>

            <div style={formGridStyle}>
              <Input
                label="Name"
                value={instrumentForm.name}
                onChange={(event) => setInstrumentForm((current) => ({ ...current, name: event.target.value }))}
              />
              <Select
                label="Type"
                value={instrumentForm.type}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, type: event.target.value as InstrumentType }))
                }
              >
                {INSTRUMENT_TYPES.map((instrumentType) => (
                  <option key={instrumentType.value} value={instrumentType.value}>
                    {instrumentType.label}
                  </option>
                ))}
              </Select>
              <Input
                label="Ticker"
                value={instrumentForm.ticker}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))
                }
              />
              <Input
                label="Currency"
                value={instrumentForm.currency}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
              />
              <Input
                label="Sector"
                value={instrumentForm.sector}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, sector: event.target.value }))
                }
              />
              <Input
                label="Geography"
                value={instrumentForm.geography}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, geography: event.target.value }))
                }
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={fieldLabelStyle}>Notes</label>
              <textarea
                rows={5}
                style={textareaStyle}
                value={instrumentForm.notes}
                onChange={(event) =>
                  setInstrumentForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>

            {instrumentError ? <div style={modalErrorStyle}>{instrumentError}</div> : null}

            <div style={modalFooterStyle}>
              <Button type="button" variant="ghost" onClick={closeInstrumentModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={instrumentSaving}>
                {instrumentSaving ? 'Saving...' : editingInstrument ? 'Update Instrument' : 'Create Instrument'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MetricCell({
  label,
  value,
  mono = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: string;
}) {
  return (
    <div style={metricCellStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div
        style={{
          ...metricValueStyle,
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font)',
          color: tone ?? 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div style={metricPillStyle}>
      <div style={metricPillLabelStyle}>{label}</div>
      <div style={{ ...metricPillValueStyle, color: tone }}>{value}</div>
    </div>
  );
}

function CategoryGroupPanel({
  title,
  accent,
  categories,
  allCategories,
  onEdit,
  onDelete,
}: {
  title: string;
  accent: string;
  categories: FlatCategory[];
  allCategories: FlatCategory[];
  onEdit: (category: FlatCategory) => void;
  onDelete: (category: FlatCategory) => void | Promise<void>;
}) {
  return (
    <section style={dataPanelStyle}>
      <div style={dataPanelHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>{title}</div>
          <div style={{ ...dataPanelCountStyle, color: accent }}>{categories.length} entries</div>
        </div>
        <div style={{ ...tileBarStyle, background: accent, marginBottom: 0 }} />
      </div>
      <div style={dataListStyle}>
        {categories.map((category) => (
          <div key={category.id} style={dataRowStyle}>
            <div style={categoryIdentityStyle(category.level)}>
              <span style={colorDotStyle(category.color_hex)} />
              <div style={truncateWrapStyle}>
                <div style={dataRowTitleStyle}>
                  <span>{category.name}</span>
                  {category.is_default ? <span style={tagStyle}>Default</span> : null}
                </div>
                <div style={dataRowMetaStyle}>
                  {parentName(allCategories, category.parent_id)} · {category.icon_emoji ?? '--'} · {category.color_hex}
                </div>
              </div>
            </div>
            <div style={rowActionsStyle}>
              <button type="button" style={textActionStyle} onClick={() => onEdit(category)}>
                Edit
              </button>
              <button type="button" style={{ ...textActionStyle, color: 'var(--red)' }} onClick={() => void onDelete(category)}>
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InstrumentGroupPanel({
  type,
  instruments,
  onEdit,
  onDelete,
}: {
  type: InstrumentType;
  instruments: Instrument[];
  onEdit: (instrument: Instrument) => void;
  onDelete: (instrument: Instrument) => void | Promise<void>;
}) {
  return (
    <section style={dataPanelStyle}>
      <div style={dataPanelHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>{instrumentTypeLabel(type)}</div>
          <div style={{ ...dataPanelCountStyle, color: instrumentTypeTone(type) }}>
            {instruments.length} instruments
          </div>
        </div>
        <div style={{ ...tileBarStyle, background: instrumentTypeTone(type), marginBottom: 0 }} />
      </div>
      <div style={dataListStyle}>
        {instruments.map((instrument) => (
          <div key={instrument.id} style={dataRowStyle}>
            <div style={truncateWrapStyle}>
              <div style={dataRowTitleStyle}>
                <span>{instrument.name}</span>
                <span style={typeBadgeStyle}>{instrument.currency}</span>
              </div>
              <div style={dataRowMetaStyle}>
                {(instrument.ticker ?? '--')} · {(instrument.sector ?? 'No sector')} · {(instrument.geography ?? 'No geography')}
              </div>
            </div>
            <div style={rowActionsStyle}>
              <button type="button" style={textActionStyle} onClick={() => onEdit(instrument)}>
                Edit
              </button>
              <button type="button" style={{ ...textActionStyle, color: 'var(--red)' }} onClick={() => void onDelete(instrument)}>
                Archive
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function flattenCategories(categories: CategoryNode[], level = 0): FlatCategory[] {
  return categories.flatMap((category) => [
    {
      id: category.id,
      name: category.name,
      type: category.type,
      color_hex: category.color_hex,
      icon_emoji: category.icon_emoji,
      parent_id: category.parent_id,
      level,
      is_default: category.is_default,
    },
    ...flattenCategories(category.children, level + 1),
  ]);
}

function parentName(categories: FlatCategory[], parentId: string | null): string {
  if (!parentId) return '--';
  return categories.find((category) => category.id === parentId)?.name ?? '--';
}

function categoryLabel(category: FlatCategory): string {
  return `${'· '.repeat(category.level)}${category.name}`;
}

function instrumentTypeLabel(type: InstrumentType): string {
  return INSTRUMENT_TYPES.find((item) => item.value === type)?.label ?? type.toUpperCase();
}

function instrumentTypeTone(type: InstrumentType): string {
  switch (type) {
    case 'equity':
      return 'var(--blue)';
    case 'mf':
      return 'var(--green)';
    case 'etf':
      return 'var(--cyan)';
    case 'bond':
      return 'var(--accent)';
    case 'gold':
      return '#D4B04C';
    case 'crypto':
      return 'var(--purple)';
    default:
      return 'var(--text2)';
  }
}

function blankCategoryForm(): CategoryFormState {
  return {
    name: '',
    type: 'expense',
    parent_id: '',
    color_hex: '#3A7FFF',
    icon_emoji: '',
  };
}

function blankInstrumentForm(): InstrumentFormState {
  return {
    name: '',
    type: 'equity',
    ticker: '',
    currency: 'INR',
    sector: '',
    geography: '',
    notes: '',
  };
}

const pageStyle: CSSProperties = {
  minHeight: '100%',
  padding: '18px 20px 24px',
  background: 'var(--bg)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 14,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
};

const titleStyle: CSSProperties = {
  margin: '4px 0 0',
  fontFamily: 'var(--font-cond)',
  fontSize: 22,
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  color: 'var(--text)',
};

const errorBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 12,
  padding: '8px 10px',
  border: '1px solid rgba(240, 64, 96, 0.35)',
  background: 'rgba(240, 64, 96, 0.08)',
  color: 'var(--red)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

const inlineActionButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font-cond)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '340px minmax(0, 1fr)',
  gap: 14,
  alignItems: 'start',
};

const profileCardStyle: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
};

const mainPanelStyle: CSSProperties = {
  minHeight: 520,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
};

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
};

const profileBodyStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: 14,
  borderBottom: '1px solid var(--border)',
  minWidth: 0,
};

const avatarStyle: CSSProperties = {
  width: 64,
  height: 64,
  background: 'linear-gradient(135deg, var(--blue), var(--blue2))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text)',
};

const profileMetaStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 4,
};

const profileNameStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 18,
  lineHeight: 1.1,
  color: 'var(--text)',
  overflowWrap: 'anywhere',
};

const profileEmailStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--text2)',
  wordBreak: 'break-word',
};

const profileFactsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 1,
  background: 'var(--border)',
};

const metricCellStyle: CSSProperties = {
  padding: '10px 12px',
  background: 'var(--bg2)',
};

const metricLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 4,
};

const metricValueStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
};

const tileGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 1,
  background: 'var(--border)',
};

const tileStyle: CSSProperties = {
  position: 'relative',
  minHeight: 180,
  padding: '18px 18px 14px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  textAlign: 'left',
};

const tileBarStyle: CSSProperties = {
  width: 30,
  height: 3,
  marginBottom: 12,
};

const tileLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 18,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text)',
  marginBottom: 10,
};

const tileDescriptionStyle: CSSProperties = {
  maxWidth: 260,
  fontSize: 13,
  color: 'var(--text2)',
  lineHeight: 1.5,
};

const tileFootStyle: CSSProperties = {
  position: 'absolute',
  left: 14,
  right: 14,
  bottom: 12,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text3)',
};

const subtleNoteStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const rowActionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  flexShrink: 0,
};

const textActionStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: 'var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font-cond)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const tagStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  background: 'var(--bg4)',
  color: 'var(--text3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const typeBadgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '1px 6px',
  background: 'rgba(58, 127, 255, 0.12)',
  color: 'var(--blue)',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const contentPadStyle: CSSProperties = {
  padding: 12,
};

const summaryStripStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 8,
  marginBottom: 12,
};

const metricPillStyle: CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg3)',
};

const metricPillLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text3)',
  marginBottom: 4,
};

const metricPillValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 16,
  lineHeight: 1.1,
};

const splitPanelGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: 12,
};

const instrumentPanelGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 12,
};

const dataPanelStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg3)',
  minWidth: 0,
};

const dataPanelHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
};

const dataPanelCountStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const dataListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const dataRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  minWidth: 0,
};

const dataRowTitleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'var(--font)',
  fontSize: 13,
  color: 'var(--text)',
  marginBottom: 3,
  minWidth: 0,
};

const dataRowMetaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  overflowWrap: 'anywhere',
};

const categoryIdentityStyle = (level: number): CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  paddingLeft: level * 16,
  minWidth: 0,
  flex: 1,
});

const truncateWrapStyle: CSSProperties = {
  minWidth: 0,
  flex: 1,
};

const emptyStatePanelStyle: CSSProperties = {
  padding: '28px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg3)',
  textAlign: 'center',
  color: 'var(--text3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(10, 12, 15, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  zIndex: 1000,
};

const modalStyle: CSSProperties = {
  width: '100%',
  maxWidth: 560,
  background: 'var(--bg2)',
  border: '1px solid var(--border2)',
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
  padding: 16,
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 14,
};

const modalTitleStyle: CSSProperties = {
  marginTop: 4,
  fontFamily: 'var(--font-cond)',
  fontSize: 18,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const modalCloseButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'var(--text3)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
};

const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text3)',
  marginBottom: 3,
  display: 'block',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  color: 'var(--text)',
  padding: '8px 10px',
  fontFamily: 'var(--font)',
  fontSize: 12,
  resize: 'vertical',
  outline: 'none',
  borderRadius: 2,
};

const modalErrorStyle: CSSProperties = {
  marginTop: 12,
  padding: '8px 10px',
  border: '1px solid rgba(240, 64, 96, 0.35)',
  background: 'rgba(240, 64, 96, 0.08)',
  color: 'var(--red)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

const modalFooterStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 14,
};

const colorDotStyle = (color: string): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: 999,
  background: color,
  flexShrink: 0,
});
