#!/bin/bash
# Rewrites /record transaction flow — machine selected per transaction
# Run from repo root: bash apply-record-flow.sh

set -e

cat > frontend/src/pages/StaffTransactions.tsx << 'EOF'
import React, { useState, useEffect } from 'react';
import {
  ArrowDownCircle, ArrowUpCircle, ArrowLeftRight,
  Smartphone, CheckCircle2, RefreshCw, History, LogOut, ChevronLeft,
} from 'lucide-react';
import { Spinner } from '../components/ui';
import { fmtNGN, fmtDatetime } from '../utils/format';

const API = 'https://alternate-pos-audit.vercel.app';

function staffFetch(path: string, opts: any = {}) {
  const token = localStorage.getItem('staff_token') || localStorage.getItem('access_token');
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  }).then(r => r.json());
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TX_TYPES = [
  { id: 'withdrawal', label: 'Withdrawal', icon: ArrowUpCircle,   color: '#F04C4C', bg: 'rgba(240,76,76,0.1)',   border: 'rgba(240,76,76,0.3)' },
  { id: 'deposit',    label: 'Deposit',    icon: ArrowDownCircle, color: '#2ECC8A', bg: 'rgba(46,204,138,0.1)',  border: 'rgba(46,204,138,0.3)' },
  { id: 'transfer',   label: 'Transfer',   icon: ArrowLeftRight,  color: '#4A9EF5', bg: 'rgba(74,158,245,0.1)', border: 'rgba(74,158,245,0.3)' },
];

const QUICK = [
  { label: '₦1K', value: 100000 }, { label: '₦2K', value: 200000 },
  { label: '₦5K', value: 500000 }, { label: '₦10K', value: 1000000 },
  { label: '₦20K', value: 2000000 }, { label: '₦50K', value: 5000000 },
  { label: '₦100K', value: 10000000 },
];

// ─── Number pad ───────────────────────────────────────────────────────────────

function NumPad({ onInput, onDelete }: { onInput: (d: string) => void; onDelete: () => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','000','0','⌫'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {keys.map(k => (
        <button key={k} onClick={() => k === '⌫' ? onDelete() : onInput(k)}
          style={{ padding: '16px 8px', background: k === '⌫' ? 'var(--bg-overlay)' : 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: k === '⌫' ? 18 : 20, fontFamily: 'var(--font-mono)', fontWeight: 500, color: k === '⌫' ? 'var(--text-secondary)' : 'var(--text-primary)', cursor: 'pointer', touchAction: 'manipulation' }}
          onMouseDown={e => (e.currentTarget.style.background = 'var(--bg-overlay)')}
          onMouseUp={e => (e.currentTarget.style.background = k === '⌫' ? 'var(--bg-overlay)' : 'var(--bg-raised)')}
        >{k}</button>
      ))}
    </div>
  );
}

// ─── Staff Login ──────────────────────────────────────────────────────────────

function StaffLoginPage({ onLogin }: { onLogin: (data: any) => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) { setError('PIN must be 4 digits'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/api/staff/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), pin }),
      }).then(r => r.json());
      if (res.success) { localStorage.setItem('staff_token', res.data.token); onLogin(res.data); }
      else setError(res.error ?? 'Login failed');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--gold)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Smartphone size={24} color="var(--text-inverse)" />
          </div>
          <h2 style={{ marginBottom: 4 }}>Staff Login</h2>
          <p style={{ fontSize: 14 }}>Enter your phone number and PIN</p>
        </div>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, fontWeight: 500 }}>Phone number</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="08012345678" style={{ fontSize: 16 }} required />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4, fontWeight: 500 }}>4-digit PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="••••" style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }} required />
          </div>
          {error && <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div>}
          <button type="submit" disabled={loading || !phone || pin.length !== 4}
            style={{ padding: '14px', background: 'var(--gold)', color: 'var(--text-inverse)', border: 'none', borderRadius: 'var(--r-lg)', fontSize: 15, fontFamily: 'var(--font-body)', fontWeight: 600, cursor: 'pointer', opacity: loading || !phone || pin.length !== 4 ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? <Spinner size={18} color="var(--text-inverse)" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
// Flow: Login → [Type] → [Machine] → [Amount] → Record
// Steps: 'type' | 'machine' | 'amount' | 'history'

export function StaffTransactionsPage() {
  const [staffData, setStaffData] = useState<any>(null);
  const [machines, setMachines] = useState<any[]>([]);
  const [step, setStep] = useState<'type' | 'machine' | 'amount' | 'history'>('type');
  const [txType, setTxType] = useState<string | null>(null);
  const [machine, setMachine] = useState<any>(null);
  const [amtStr, setAmtStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [showFeeOverride, setShowFeeOverride] = useState(false);
  const [actualFee, setActualFee] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [hLoading, setHLoading] = useState(false);

  // Check existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('staff_token');
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.role === 'staff' && payload.exp * 1000 > Date.now()) {
        staffFetch('/api/staff/machines').then(res => {
          if (res.success) {
            setMachines(res.data ?? []);
            setStaffData({ staff: { full_name: payload.email?.replace('staff_','')?.replace('@internal','') ?? 'Staff', id: payload.sub }, token });
          }
        }).catch(() => {});
      } else {
        localStorage.removeItem('staff_token');
      }
    } catch { localStorage.removeItem('staff_token'); }
  }, []);

  // Back button
  useEffect(() => {
    const handlePop = () => {
      if (step === 'amount') setStep(machines.length > 1 ? 'machine' : 'type');
      else if (step === 'machine') setStep('type');
      else if (step === 'history') setStep('type');
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [step, machines]);

  const handleLogin = (data: any) => {
    setStaffData(data);
    staffFetch('/api/staff/machines').then(res => {
      setMachines(res.data ?? []);
      // If staff has exactly one machine, skip machine selection step
      if (res.data?.length === 1) setMachine(res.data[0]);
    }).catch(() => {});
  };

  const handleLogout = () => {
    localStorage.removeItem('staff_token');
    setStaffData(null);
    setMachines([]);
    setMachine(null);
    setTxType(null);
    setAmtStr('');
    setStep('type');
  };

  const selectType = (type: string) => {
    setTxType(type);
    setResult(null);
    setError('');
    window.history.pushState({ step: 'machine' }, '');
    // If only one machine, skip to amount
    if (machines.length === 1) {
      setMachine(machines[0]);
      setStep('amount');
    } else {
      setStep('machine');
    }
  };

  const selectMachine = (m: any) => {
    setMachine(m);
    window.history.pushState({ step: 'amount' }, '');
    setStep('amount');
  };

  const goBack = () => {
    if (step === 'amount') {
      if (machines.length > 1) { setStep('machine'); setMachine(null); }
      else { setStep('type'); setTxType(null); }
    } else if (step === 'machine') {
      setStep('type'); setTxType(null);
    }
    setAmtStr('');
    setError('');
    setResult(null);
    setShowFeeOverride(false);
    setActualFee('');
  };

  const amtKobo = parseInt(amtStr || '0');

  const submit = async () => {
    if (!machine || !txType || amtKobo <= 0) return;
    setSubmitting(true); setError('');
    try {
      const res = await staffFetch('/api/staff/transactions', {
        method: 'POST',
        body: JSON.stringify({
          machine_id: machine.id,
          transaction_type: txType,
          amount: amtKobo,
          ...(actualFee ? { actual_fee: Math.round(parseFloat(actualFee) * 100) } : {}),
        }),
      });
      if (res.success) {
        if (res.no_rule_found) {
          setShowFeeOverride(true);
          setResult({ _prompt_fee: true, amount: amtKobo });
        } else {
          setResult(res.data);
          setAmtStr('');
          setActualFee('');
          setShowFeeOverride(false);
          // Stay on amount screen — ready for next transaction on same machine/type
          setTimeout(() => setResult(null), 4000);
        }
      } else {
        setError(res.error ?? 'Failed to record');
      }
    } catch { setError('Network error'); }
    finally { setSubmitting(false); }
  };

  const loadHistory = async () => {
    setHLoading(true);
    try {
      const r = await staffFetch('/api/staff/transactions');
      setHistory(r.data ?? []); setSummary(r.summary);
    } catch {} finally { setHLoading(false); }
  };

  useEffect(() => { if (step === 'history') loadHistory(); }, [step]);

  if (!staffData) return <StaffLoginPage onLogin={handleLogin} />;

  const tt = TX_TYPES.find(t => t.id === txType);

  // ── Header ──────────────────────────────────────────────────────────────────
  const Header = () => (
    <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {(step === 'machine' || step === 'amount') && (
          <button onClick={goBack} style={{ background: 'none', color: 'var(--text-secondary)', padding: '4px 6px', cursor: 'pointer', borderRadius: 6, marginRight: 4 }}>
            <ChevronLeft size={20} />
          </button>
        )}
        <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Smartphone size={14} color="var(--text-inverse)" />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>
            {step === 'type' && 'What type of transaction?'}
            {step === 'machine' && `${tt?.label} — Select machine`}
            {step === 'amount' && `${tt?.label} · ${machine?.name}`}
            {step === 'history' && 'My transactions today'}
          </div>
          {(step === 'amount') && (
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{machine?.branch_name}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {step === 'type' && (
          <button onClick={() => { window.history.pushState({}, ''); setStep('history'); }}
            style={{ background: 'none', color: 'var(--text-secondary)', padding: '5px 10px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, border: '1px solid var(--border)' }}>
            <History size={14} /> History
          </button>
        )}
        {step === 'history' && (
          <button onClick={() => setStep('type')}
            style={{ background: 'none', color: 'var(--text-secondary)', padding: '5px 10px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, border: '1px solid var(--border)' }}>
            <Smartphone size={14} /> Record
          </button>
        )}
        <button onClick={handleLogout} style={{ background: 'none', color: 'var(--text-tertiary)', padding: 7, borderRadius: 8, cursor: 'pointer' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', maxWidth: 420, margin: '0 auto', paddingBottom: 20 }}>
      <Header />

      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Step 1: Transaction type ── */}
        {step === 'type' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {TX_TYPES.map(t => (
              <button key={t.id} onClick={() => selectType(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 20px', background: 'var(--bg-surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--r-lg)', cursor: 'pointer', touchAction: 'manipulation', transition: 'all 0.15s', textAlign: 'left' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = t.color; (e.currentTarget as HTMLElement).style.background = t.bg; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: t.bg, border: `1.5px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <t.icon size={22} color={t.color} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{t.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t.id === 'withdrawal' ? 'Customer takes cash out' : t.id === 'deposit' ? 'Customer puts cash in' : 'Send money to an account'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 2: Machine selection ── */}
        {step === 'machine' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {machines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                <div>No machines assigned. Contact your manager.</div>
              </div>
            ) : machines.map(m => (
              <button key={m.id} onClick={() => selectMachine(m)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', background: 'var(--bg-surface)', border: '1.5px solid var(--border)', borderRadius: 'var(--r-lg)', cursor: 'pointer', touchAction: 'manipulation', transition: 'all 0.15s', textAlign: 'left', width: '100%' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.background = 'var(--gold-glow)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'; }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{m.branch_name} · {m.provider}</div>
                </div>
                <ChevronLeft size={18} color="var(--text-tertiary)" style={{ transform: 'rotate(180deg)' }} />
              </button>
            ))}
          </div>
        )}

        {/* ── Step 3: Amount entry ── */}
        {step === 'amount' && (
          <>
            {/* Success / fee prompt */}
            {result && (
              <div style={{ background: result._prompt_fee ? 'rgba(232,168,48,0.08)' : 'var(--green-dim)', border: `1px solid ${result._prompt_fee ? 'var(--gold)' : 'var(--green)'}`, borderRadius: 'var(--r-lg)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                {result._prompt_fee
                  ? <div style={{ fontSize: 18 }}>⚠️</div>
                  : <CheckCircle2 size={22} color="var(--green)" />
                }
                <div>
                  <div style={{ fontWeight: 600, color: result._prompt_fee ? 'var(--gold)' : 'var(--green)', marginBottom: 2 }}>
                    {result._prompt_fee ? 'No fee rule — enter fee below' : 'Recorded ✓'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {result._prompt_fee
                      ? 'Type the amount you charged, then tap Record again'
                      : `${fmtNGN(result.amount)} · Fee: ${fmtNGN(result.actual_fee ?? result.our_fee)}${result.fee_overridden ? ' ★' : ''}`
                    }
                  </div>
                </div>
              </div>
            )}

            {error && <div style={{ background: 'var(--red-dim)', border: '1px solid var(--red)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div>}

            {/* Amount display */}
            <div style={{ background: 'var(--bg-surface)', border: `2px solid ${amtKobo > 0 ? tt?.border ?? 'var(--border-mid)' : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '20px', textAlign: 'center', transition: 'border-color 0.2s' }}>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Amount</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 38, fontWeight: 600, color: amtKobo > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', letterSpacing: '-0.02em', minHeight: 46 }}>
                {amtKobo > 0 ? `₦${(amtKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '₦0.00'}
              </div>
            </div>

            {/* Quick amounts */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {QUICK.map(q => (
                <button key={q.value} onClick={() => setAmtStr(String(q.value))}
                  style={{ padding: '6px 12px', borderRadius: 'var(--r-full)', background: amtKobo === q.value ? 'var(--gold)' : 'var(--bg-raised)', color: amtKobo === q.value ? 'var(--text-inverse)' : 'var(--text-secondary)', border: `1px solid ${amtKobo === q.value ? 'var(--gold)' : 'var(--border)'}`, fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', fontWeight: amtKobo === q.value ? 600 : 400, touchAction: 'manipulation' }}>
                  {q.label}
                </button>
              ))}
            </div>

            <NumPad onInput={d => setAmtStr(p => { const n = p + d; return parseInt(n) > 1_000_000_000 ? p : n; })} onDelete={() => setAmtStr(p => p.slice(0, -1))} />

            {/* Fee override */}
            {showFeeOverride ? (
              <div style={{ background: result?._prompt_fee ? 'rgba(232,168,48,0.08)' : 'var(--bg-raised)', border: `1px solid ${result?._prompt_fee ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Fee charged (₦)</span>
                  <input type="number" value={actualFee} onChange={e => setActualFee(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && actualFee) submit(); }}
                    placeholder="e.g. 150" inputMode="decimal" autoFocus
                    style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', fontWeight: 600 }} />
                  {!result?._prompt_fee && (
                    <button onClick={() => { setShowFeeOverride(false); setActualFee(''); }} style={{ background: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13 }}>✕</button>
                  )}
                </div>
              </div>
            ) : (
              <button onClick={() => setShowFeeOverride(true)} style={{ background: 'none', fontSize: 12, color: 'var(--text-tertiary)', cursor: 'pointer', textDecoration: 'underline', padding: '2px 0', alignSelf: 'flex-start' }}>
                Override fee (optional)
              </button>
            )}

            {/* Record button */}
            <button onClick={submit} disabled={amtKobo <= 0 || submitting || (result?._prompt_fee && !actualFee)}
              style={{ width: '100%', padding: '18px', background: amtKobo <= 0 ? 'var(--bg-raised)' : tt?.color ?? 'var(--gold)', color: amtKobo <= 0 ? 'var(--text-tertiary)' : 'white', border: 'none', borderRadius: 'var(--r-lg)', fontSize: 17, fontFamily: 'var(--font-body)', fontWeight: 600, cursor: amtKobo <= 0 ? 'not-allowed' : 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, touchAction: 'manipulation' }}>
              {submitting ? <Spinner size={20} color="white" /> : amtKobo > 0 ? `Record ${tt?.label} — ₦${(amtKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : 'Enter amount'}
            </button>
          </>
        )}

        {/* ── History ── */}
        {step === 'history' && (
          <>
            {summary && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Count',  value: summary.count.toLocaleString(),     color: 'var(--text-primary)' },
                  { label: 'Volume', value: fmtNGN(summary.volume, true),        color: 'var(--text-primary)' },
                  { label: 'Profit', value: fmtNGN(summary.profit, true),        color: 'var(--green)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Today's transactions</div>
              <button onClick={loadHistory} style={{ background: 'none', color: 'var(--text-tertiary)', padding: 6, cursor: 'pointer', borderRadius: 6 }}><RefreshCw size={14} /></button>
            </div>
            {hLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={24} /></div>
              : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
                  <History size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <div style={{ fontSize: 14 }}>No transactions recorded today</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map((tx: any) => {
                    const t = TX_TYPES.find(x => x.id === tx.transaction_type);
                    return (
                      <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: t?.bg ?? 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {t && <t.icon size={18} color={t.color} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 1 }}>{t?.label ?? tx.transaction_type}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{tx.machine_name} · {fmtDatetime(tx.transaction_at)}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{fmtNGN(tx.amount)}</div>
                          <div style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>+{fmtNGN(tx.net_profit)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </>
        )}
      </div>
    </div>
  );
}
EOF

echo "✅ StaffTransactions.tsx rewritten — new flow: type → machine → amount"
echo ""
echo "Now run:"
echo "  git add ."
echo "  git commit -m 'phase 5d: new tx flow type→machine→amount, staff edit fix'"
echo "  git push origin main"
