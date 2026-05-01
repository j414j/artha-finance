import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { getAccounts } from '../api/accounts'
import {
  blockGoalFunds,
  completeGoal,
  createGoal,
  getGoalHistory,
  getGoals,
  releaseGoalFunds,
  updateGoal,
} from '../api/goals'
import { ApiError } from '../api/client'
import Button from '../components/Button'
import Input from '../components/Input'
import Select from '../components/Select'
import type { Account } from '../types/account'
import type {
  Goal,
  GoalAccountAvailability,
  GoalCreatePayload,
  GoalEvent,
  GoalFundsPayload,
  GoalUpdatePayload,
} from '../types/goal'
import { formatDateDisplay, formatMoney, parseMoneyInput, paiseToInput } from '../utils/format'

type GoalTab = 'active' | 'completed'
type GoalModalMode = 'create' | 'edit'
type FundsModalMode = 'block' | 'release'

interface GoalFormState {
  name: string
  targetAmount: string
  sourceAccountId: string
  targetDate: string
  notes: string
}

interface FundsFormState {
  amount: string
  date: string
  notes: string
}

export default function GoalsPage() {
  const [tab, setTab] = useState<GoalTab>('active')
  const [activeGoals, setActiveGoals] = useState<Goal[]>([])
  const [completedGoals, setCompletedGoals] = useState<Goal[]>([])
  const [accountAvailability, setAccountAvailability] = useState<GoalAccountAvailability[]>([])
  const [totalBlocked, setTotalBlocked] = useState(0)
  const [sourceAccounts, setSourceAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [goalModalMode, setGoalModalMode] = useState<GoalModalMode | null>(null)
  const [goalModalGoal, setGoalModalGoal] = useState<Goal | null>(null)
  const [goalForm, setGoalForm] = useState<GoalFormState>(emptyGoalForm())
  const [goalFormError, setGoalFormError] = useState('')
  const [fundsModalMode, setFundsModalMode] = useState<FundsModalMode | null>(null)
  const [fundsGoal, setFundsGoal] = useState<Goal | null>(null)
  const [fundsForm, setFundsForm] = useState<FundsFormState>(emptyFundsForm())
  const [fundsFormError, setFundsFormError] = useState('')
  const [historyGoal, setHistoryGoal] = useState<Goal | null>(null)
  const [historyEvents, setHistoryEvents] = useState<GoalEvent[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')

  const loadPage = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [goalsResponse, accountsResponse] = await Promise.all([getGoals(), getAccounts()])
      const accounts = [
        ...accountsResponse.asset_groups.flatMap((group) => group.accounts),
        ...accountsResponse.liability_groups.flatMap((group) => group.accounts),
      ].filter((account) => account.type === 'savings' || account.type === 'current')
      setActiveGoals(goalsResponse.active_goals)
      setCompletedGoals(goalsResponse.completed_goals)
      setAccountAvailability(goalsResponse.account_availability)
      setTotalBlocked(goalsResponse.total_blocked_paise)
      setSourceAccounts(accounts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load goals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  const visibleGoals = tab === 'active' ? activeGoals : completedGoals
  const accountNames = useMemo(
    () => new Map(accountAvailability.map((row) => [row.account_id, row.account_name])),
    [accountAvailability],
  )

  const openCreateModal = () => {
    setGoalForm({
      ...emptyGoalForm(),
      sourceAccountId: sourceAccounts[0]?.id ?? '',
    })
    setGoalModalGoal(null)
    setGoalFormError('')
    setGoalModalMode('create')
  }

  const openEditModal = (goal: Goal) => {
    setGoalForm({
      name: goal.name,
      targetAmount: paiseToInput(goal.target_amount_paise),
      sourceAccountId: goal.source_account_id,
      targetDate: goal.target_date ?? '',
      notes: goal.notes ?? '',
    })
    setGoalModalGoal(goal)
    setGoalFormError('')
    setGoalModalMode('edit')
  }

  const openFundsModal = (mode: FundsModalMode, goal: Goal) => {
    setFundsGoal(goal)
    setFundsForm({
      amount: '',
      date: todayInput(),
      notes: '',
    })
    setFundsFormError('')
    setFundsModalMode(mode)
  }

  const openHistoryModal = async (goal: Goal) => {
    setHistoryGoal(goal)
    setHistoryLoading(true)
    setHistoryError('')
    setHistoryEvents([])
    try {
      const response = await getGoalHistory(goal.id)
      setHistoryEvents(response.events)
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : 'Unable to load history')
    } finally {
      setHistoryLoading(false)
    }
  }

  const closeGoalModal = () => {
    if (!saving) {
      setGoalModalMode(null)
      setGoalModalGoal(null)
      setGoalFormError('')
    }
  }

  const closeFundsModal = () => {
    if (!saving) {
      setFundsModalMode(null)
      setFundsGoal(null)
      setFundsFormError('')
    }
  }

  const closeHistoryModal = () => {
    setHistoryGoal(null)
    setHistoryEvents([])
    setHistoryError('')
  }

  const handleGoalSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!goalModalMode) return
    setSaving(true)
    setGoalFormError('')
    try {
      if (goalModalMode === 'create') {
        const payload = buildGoalCreatePayload(goalForm)
        await createGoal(payload)
      } else if (goalModalGoal) {
        const payload = buildGoalUpdatePayload(goalForm, goalModalGoal)
        await updateGoal(goalModalGoal.id, payload)
      }
      setGoalModalMode(null)
      await loadPage()
    } catch (err) {
      setGoalFormError(err instanceof Error ? err.message : 'Unable to save goal')
    } finally {
      setSaving(false)
    }
  }

  const handleFundsSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!fundsModalMode || !fundsGoal) return
    setSaving(true)
    setFundsFormError('')
    try {
      const payload = buildFundsPayload(fundsForm)
      if (fundsModalMode === 'block') {
        await blockGoalFunds(fundsGoal.id, payload)
      } else {
        await releaseGoalFunds(fundsGoal.id, payload)
      }
      setFundsModalMode(null)
      await loadPage()
    } catch (err) {
      setFundsFormError(err instanceof Error ? err.message : 'Unable to save goal funds')
    } finally {
      setSaving(false)
    }
  }

  const handleComplete = async (goal: Goal) => {
    if (!window.confirm(`Mark ${goal.name} complete and release blocked funds?`)) return
    setSaving(true)
    try {
      await completeGoal(goal.id, { date: todayInput() })
      await loadPage()
      if (tab !== 'completed') setTab('completed')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to complete goal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)' }}>
      <div style={topBarStyle}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setTab('active')}
            style={tabStyle(tab === 'active')}
          >
            Active ({activeGoals.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('completed')}
            style={tabStyle(tab === 'completed')}
          >
            Completed ({completedGoals.length})
          </button>
        </div>
        <Button onClick={openCreateModal} disabled={loading || sourceAccounts.length === 0}>
          + New Goal
        </Button>
      </div>

      {error && (
        <div style={noticeStyle('error')}>
          {error}
          <button onClick={() => void loadPage()} style={noticeButtonStyle}>
            Retry
          </button>
        </div>
      )}

      <div style={gridShellStyle}>
        {loading ? (
          <div style={emptyCardStyle}>Loading goals</div>
        ) : visibleGoals.length > 0 ? (
          visibleGoals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={tab === 'active' ? openEditModal : undefined}
              onBlock={tab === 'active' ? (item) => openFundsModal('block', item) : undefined}
              onRelease={
                tab === 'active' ? (item) => openFundsModal('release', item) : undefined
              }
              onHistory={openHistoryModal}
              onComplete={tab === 'active' ? handleComplete : undefined}
            />
          ))
        ) : (
          <div style={emptyCardStyle}>
            {tab === 'active' ? 'No active goals' : 'No completed goals'}
          </div>
        )}

        <AvailabilityCard
          rows={accountAvailability}
          totalBlocked={totalBlocked}
          loading={loading}
          accountNames={accountNames}
        />
      </div>

      {goalModalMode && (
        <GoalModal
          mode={goalModalMode}
          form={goalForm}
          error={goalFormError}
          saving={saving}
          sourceAccounts={sourceAccounts}
          onClose={closeGoalModal}
          onChange={setGoalForm}
          onSubmit={handleGoalSubmit}
        />
      )}

      {fundsModalMode && fundsGoal && (
        <FundsModal
          mode={fundsModalMode}
          goal={fundsGoal}
          form={fundsForm}
          error={fundsFormError}
          saving={saving}
          onClose={closeFundsModal}
          onChange={setFundsForm}
          onSubmit={handleFundsSubmit}
        />
      )}

      {historyGoal && (
        <HistoryModal
          goal={historyGoal}
          events={historyEvents}
          loading={historyLoading}
          error={historyError}
          onClose={closeHistoryModal}
        />
      )}
    </div>
  )
}

function GoalCard({
  goal,
  onEdit,
  onBlock,
  onRelease,
  onHistory,
  onComplete,
}: {
  goal: Goal
  onEdit?: (goal: Goal) => void
  onBlock?: (goal: Goal) => void
  onRelease?: (goal: Goal) => void
  onHistory: (goal: Goal) => void
  onComplete?: (goal: Goal) => void
}) {
  const progressVariant =
    goal.status_tone === 'red' ? 'red' : goal.status_tone === 'amber' ? 'amber' : 'green'
  const metricLabel =
    goal.target_date && goal.required_monthly_paise != null && goal.status_tone !== 'green'
      ? 'NEED/MO'
      : 'PROJ. DATE'
  const metricValue =
    metricLabel === 'NEED/MO'
      ? formatMoney(goal.required_monthly_paise ?? 0)
      : goal.projected_completion_date
        ? formatMonthLabel(goal.projected_completion_date)
        : '—'
  const metricColor =
    metricLabel === 'NEED/MO'
      ? 'var(--red)'
      : goal.status_tone === 'amber'
        ? 'var(--accent)'
        : goal.status_tone === 'red'
          ? 'var(--red)'
          : 'var(--green)'

  return (
    <div style={goalCardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, background: goal.color_hex, display: 'inline-block' }} />
            <button
              type="button"
              onClick={() => onEdit?.(goal)}
              style={{
                ...goalNameButtonStyle,
                cursor: onEdit ? 'pointer' : 'default',
              }}
            >
              {goal.name}
            </button>
          </div>
          <div style={sourceLabelStyle}>Source: {goal.source_account_name}</div>
        </div>
        <span style={badgeStyle(goal.status_tone)}>{goal.status_label}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={blockedValueStyle}>{formatMoney(goal.display_amount_paise)}</div>
          <div style={metricTitleStyle}>BLOCKED</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={targetValueStyle}>{formatMoney(goal.target_amount_paise)}</div>
          <div style={metricTitleStyle}>TARGET</div>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ height: 6, background: 'var(--bg4)', overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(goal.progress_pct, 100)}%`,
              height: 6,
              background:
                progressVariant === 'red'
                  ? 'var(--red)'
                  : progressVariant === 'amber'
                    ? 'var(--accent)'
                    : 'var(--green)',
            }}
          />
        </div>
      </div>

      <div style={goalMetricsGridStyle}>
        <div>
          <div style={metricTitleStyle}>REMAINING</div>
          <div style={metricValueStyle}>{formatMoney(goal.remaining_paise)}</div>
        </div>
        <div>
          <div style={metricTitleStyle}>TARGET DATE</div>
          <div style={metricValueStyle}>
            {goal.target_date ? formatMonthLabel(goal.target_date) : 'No target'}
          </div>
        </div>
        <div>
          <div style={metricTitleStyle}>{metricLabel}</div>
          <div style={{ ...metricValueStyle, color: metricColor }}>{metricValue}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onBlock && (
          <Button size="sm" onClick={() => onBlock(goal)}>
            Block Funds
          </Button>
        )}
        {onRelease && (
          <Button size="sm" variant="ghost" onClick={() => onRelease(goal)}>
            Release
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onHistory(goal)}>
          History
        </Button>
        {onComplete && (
          <Button size="sm" variant="ghost" onClick={() => onComplete(goal)}>
            Mark Done
          </Button>
        )}
      </div>
    </div>
  )
}

function AvailabilityCard({
  rows,
  totalBlocked,
  loading,
  accountNames,
}: {
  rows: GoalAccountAvailability[]
  totalBlocked: number
  loading: boolean
  accountNames: Map<string, string>
}) {
  return (
    <div style={goalCardStyle}>
      <div style={{ ...sectionHeaderStyle, marginBottom: 10 }}>Account Available Balances</div>
      {loading ? (
        <div style={{ ...emptyCardStyle, minHeight: 0, padding: '18px 0' }}>Loading balances</div>
      ) : (
        <>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={tableHeaderStyle(false)}>Account</th>
                <th style={tableHeaderStyle(true)}>Total</th>
                <th style={tableHeaderStyle(true)}>Blocked</th>
                <th style={{ ...tableHeaderStyle(true), color: 'var(--accent)' }}>Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.account_id}>
                  <td style={tableCellStyle(false)}>
                    {accountNames.get(row.account_id) ?? row.account_name}
                  </td>
                  <td style={tableCellStyle(true)}>{formatMoney(row.total_balance_paise)}</td>
                  <td style={{ ...tableCellStyle(true), color: 'var(--accent)' }}>
                    {formatMoney(row.blocked_paise)}
                  </td>
                  <td style={{ ...tableCellStyle(true), color: 'var(--green)' }}>
                    {formatMoney(row.available_balance_paise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={blockedCalloutStyle}>
            <div style={blockedCalloutTextStyle}>
              Total blocked across all goals:{' '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                {formatMoney(totalBlocked)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function GoalModal({
  mode,
  form,
  error,
  saving,
  sourceAccounts,
  onClose,
  onChange,
  onSubmit,
}: {
  mode: GoalModalMode
  form: GoalFormState
  error: string
  saving: boolean
  sourceAccounts: Account[]
  onClose: () => void
  onChange: (form: GoalFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  const update = <K extends keyof GoalFormState>(key: K, value: GoalFormState[K]) =>
    onChange({ ...form, [key]: value })

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <form style={modalStyle} onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div>{mode === 'create' ? 'New Goal' : 'Edit Goal'}</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10 }}>
            <Input
              label="Name"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              required
            />
            <Input
              label="Target Amount"
              value={form.targetAmount}
              onChange={(event) => update('targetAmount', event.target.value)}
              inputMode="decimal"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginTop: 10 }}>
            <Select
              label="Source Account"
              value={form.sourceAccountId}
              onChange={(event) => update('sourceAccountId', event.target.value)}
              required
            >
              {sourceAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            <Input
              label="Target Date"
              type="date"
              value={form.targetDate}
              onChange={(event) => update('targetDate', event.target.value)}
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </div>

          {error && <div style={{ ...noticeStyle('error'), marginTop: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || sourceAccounts.length === 0} style={{ flex: 1 }}>
              {saving ? 'Saving' : mode === 'create' ? 'Create Goal' : 'Save Goal'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

function FundsModal({
  mode,
  goal,
  form,
  error,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  mode: FundsModalMode
  goal: Goal
  form: FundsFormState
  error: string
  saving: boolean
  onClose: () => void
  onChange: (form: FundsFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  const update = <K extends keyof FundsFormState>(key: K, value: FundsFormState[K]) =>
    onChange({ ...form, [key]: value })

  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <form style={modalStyle} onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div>{mode === 'block' ? 'Block Funds' : 'Release Funds'}</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
            {goal.name.toUpperCase()} · {goal.source_account_name.toUpperCase()}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
            <Input
              label="Amount"
              value={form.amount}
              onChange={(event) => update('amount', event.target.value)}
              inputMode="decimal"
              required
            />
            <Input
              label="Date"
              type="date"
              value={form.date}
              onChange={(event) => update('date', event.target.value)}
              required
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
              rows={3}
              style={textareaStyle}
            />
          </div>

          {error && <div style={{ ...noticeStyle('error'), marginTop: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <Button type="button" variant="ghost" onClick={onClose} style={{ flex: 1 }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} style={{ flex: 1 }}>
              {saving ? 'Saving' : mode === 'block' ? 'Block Funds' : 'Release Funds'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

function HistoryModal({
  goal,
  events,
  loading,
  error,
  onClose,
}: {
  goal: Goal
  events: GoalEvent[]
  loading: boolean
  error: string
  onClose: () => void
}) {
  return (
    <div style={modalBackdropStyle} onMouseDown={onClose}>
      <div style={{ ...modalStyle, maxWidth: 560 }} onMouseDown={(event) => event.stopPropagation()}>
        <div style={modalHeaderStyle}>
          <div>{goal.name} History</div>
          <button type="button" onClick={onClose} style={closeButtonStyle}>
            ×
          </button>
        </div>
        <div style={{ padding: 14, maxHeight: '60vh', overflowY: 'auto' }}>
          {error && <div style={{ ...noticeStyle('error'), marginBottom: 10 }}>{error}</div>}
          {loading ? (
            <div style={emptyCardStyle}>Loading history</div>
          ) : events.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {events.map((event) => (
                <div key={event.id} style={historyRowStyle}>
                  <div>
                    <div style={historyTitleStyle}>{eventLabel(event.event_type)}</div>
                    <div style={historyMetaStyle}>
                      {formatDateDisplay(event.date)}
                      {event.notes ? ` · ${event.notes}` : ''}
                    </div>
                  </div>
                  <div style={historyAmountStyle(event.event_type)}>
                    {event.event_type === 'block' ? '+' : '−'}
                    {formatMoney(event.amount_paise)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyCardStyle}>No goal history yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

function buildGoalCreatePayload(form: GoalFormState): GoalCreatePayload {
  const name = form.name.trim()
  if (!name) throw new Error('Goal name is required')
  if (!form.sourceAccountId) throw new Error('Source account is required')

  return {
    name,
    target_amount_paise: parseMoneyInput(form.targetAmount),
    source_account_id: form.sourceAccountId,
    target_date: form.targetDate.trim() || null,
    notes: form.notes.trim() || null,
  }
}

function buildGoalUpdatePayload(form: GoalFormState, goal: Goal): GoalUpdatePayload {
  const payload = buildGoalCreatePayload(form)
  const patch: GoalUpdatePayload = {}

  if (payload.name !== goal.name) patch.name = payload.name
  if (payload.target_amount_paise !== goal.target_amount_paise) {
    patch.target_amount_paise = payload.target_amount_paise
  }
  if (payload.source_account_id !== goal.source_account_id) {
    patch.source_account_id = payload.source_account_id
  }
  if ((payload.target_date ?? null) !== (goal.target_date ?? null)) patch.target_date = payload.target_date
  if ((payload.notes ?? null) !== (goal.notes ?? null)) patch.notes = payload.notes

  return patch
}

function buildFundsPayload(form: FundsFormState): GoalFundsPayload {
  if (!form.date.trim()) throw new Error('Date is required')
  return {
    amount_paise: parseMoneyInput(form.amount),
    date: form.date.trim(),
    notes: form.notes.trim() || null,
  }
}

function emptyGoalForm(): GoalFormState {
  return {
    name: '',
    targetAmount: '',
    sourceAccountId: '',
    targetDate: '',
    notes: '',
  }
}

function emptyFundsForm(): FundsFormState {
  return {
    amount: '',
    date: todayInput(),
    notes: '',
  }
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatMonthLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  })
}

function eventLabel(eventType: GoalEvent['event_type']): string {
  switch (eventType) {
    case 'block':
      return 'Funds Blocked'
    case 'release':
      return 'Funds Released'
    case 'complete_release':
      return 'Released On Completion'
    case 'cancel_release':
      return 'Released On Cancellation'
  }
}

function badgeStyle(tone: Goal['status_tone']): CSSProperties {
  const colors = {
    green: ['rgba(0,200,150,.15)', 'var(--green)'],
    amber: ['rgba(240,165,0,.15)', 'var(--accent)'],
    red: ['rgba(255,107,107,.14)', 'var(--red)'],
    neutral: ['var(--bg4)', 'var(--text2)'],
  } as const
  const [background, color] = colors[tone]
  return {
    background,
    color,
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    padding: '2px 6px',
    whiteSpace: 'nowrap',
  }
}

const topBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 14px',
  background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
}

const gridShellStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 1,
  background: 'var(--border)',
}

const goalCardStyle: CSSProperties = {
  background: 'var(--bg2)',
  padding: '14px 16px',
  minHeight: 220,
}

const emptyCardStyle: CSSProperties = {
  background: 'var(--bg2)',
  minHeight: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--font-cond)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text3)',
  fontSize: 11,
}

const goalNameButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-cond)',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'left',
}

const sourceLabelStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  fontFamily: 'var(--font-mono)',
  marginTop: 1,
}

const blockedValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 20,
  color: 'var(--accent)',
}

const targetValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 20,
  color: 'var(--text2)',
}

const goalMetricsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  fontFamily: 'var(--font-mono)',
}

const metricTitleStyle: CSSProperties = {
  color: 'var(--text3)',
  fontSize: 9,
}

const metricValueStyle: CSSProperties = {
  color: 'var(--text)',
  marginTop: 1,
  fontSize: 10,
}

const sectionHeaderStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 11,
  color: 'var(--text2)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

function tableHeaderStyle(right: boolean): CSSProperties {
  return {
    paddingBottom: 6,
    color: 'var(--text3)',
    fontFamily: 'var(--font-cond)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    textAlign: right ? 'right' : 'left',
  }
}

function tableCellStyle(right: boolean): CSSProperties {
  return {
    padding: '6px 0',
    color: 'var(--text)',
    fontFamily: right ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: right ? 10 : 11,
    textAlign: right ? 'right' : 'left',
    borderTop: '1px solid var(--border)',
  }
}

const blockedCalloutStyle: CSSProperties = {
  marginTop: 12,
  padding: 8,
  background: 'var(--bg3)',
  borderLeft: '2px solid var(--accent)',
}

const blockedCalloutTextStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--text2)',
  fontFamily: 'var(--font-cond)',
  letterSpacing: '0.04em',
}

function tabStyle(active: boolean): CSSProperties {
  return {
    border: 'none',
    background: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--accent)' : 'var(--text2)',
    fontFamily: 'var(--font-cond)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '4px 0',
    cursor: 'pointer',
  }
}

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  zIndex: 50,
}

const modalStyle: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  background: 'var(--bg2)',
  border: '1px solid var(--border2)',
  boxShadow: '0 18px 42px rgba(0,0,0,0.4)',
}

const modalHeaderStyle: CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontFamily: 'var(--font-cond)',
  fontSize: 12,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const closeButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
}

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text3)',
  marginBottom: 3,
  display: 'block',
}

const textareaStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  color: 'var(--text)',
  padding: '8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  outline: 'none',
  borderRadius: 2,
  resize: 'vertical',
}

function noticeStyle(kind: 'error'): CSSProperties {
  return {
    margin: '10px 14px 0',
    background: kind === 'error' ? 'rgba(255,107,107,.12)' : 'var(--bg3)',
    color: kind === 'error' ? 'var(--red)' : 'var(--text2)',
    border: `1px solid ${kind === 'error' ? 'rgba(255,107,107,.3)' : 'var(--border2)'}`,
    padding: '8px 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
  }
}

const noticeButtonStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  color: 'inherit',
  cursor: 'pointer',
  fontFamily: 'var(--font-cond)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontSize: 10,
}

const historyRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 0',
  borderTop: '1px solid var(--border)',
}

const historyTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-cond)',
  fontSize: 11,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const historyMetaStyle: CSSProperties = {
  color: 'var(--text3)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  marginTop: 2,
}

function historyAmountStyle(eventType: GoalEvent['event_type']): CSSProperties {
  return {
    color: eventType === 'block' ? 'var(--green)' : 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    whiteSpace: 'nowrap',
  }
}
