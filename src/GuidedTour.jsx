import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X, ChevronRight, Check } from 'lucide-react';

// ==================== Geführte Einführung ====================
// Die Einführung läuft ausschließlich im Demo-Projekt. Die App markiert Zielelemente mit
// data-tour="…" und meldet Aktionen über tour.signal('…'); alles Weitere (Reihenfolge,
// Texte, Hervorhebung, Position des Hinweisfensters) steckt in dieser Datei.

const STORAGE_KEY = 'capynote.tour.v1';

export const TOUR_STEPS = [
  {
    id: 'settings',
    view: 'setup-settings',
    targets: ['setup-student-count', 'setup-next'],
    title: 'Seitenaufteilung prüfen',
    body: 'Capy-note teilt das Klassen-PDF nach der Seitenzahl pro Schüler auf. In der Demo ergeben 8 Seiten 4 Schülerarbeiten. Klicken Sie auf „Weiter“.',
    advanceOn: ['setup:tasks-view'],
  },
  {
    id: 'add-task',
    view: 'setup-tasks',
    targets: ['add-task'],
    title: 'Aufgabe anlegen',
    body: 'Eine Aufgabe ist ein Ausschnitt, der bei allen Schülerarbeiten an derselben Stelle liegt. Klicken Sie auf „Aufgabenbereich hinzufügen“.',
    advanceOn: ['setup:select-task'],
  },
  {
    id: 'draw-region',
    view: 'setup-tasks',
    targets: ['pdf-page'],
    title: 'Bereich markieren',
    body: 'Ziehen Sie mit gedrückter Maustaste ein Rechteck über eine Aufgabe, zum Beispiel über „Aufgabenbereich 1“. Danach vergeben Sie einen Namen und die maximale Punktzahl.',
    advanceOn: ['setup:task-created'],
    backOn: { 'setup:select-cancel': 'add-task' },
  },
  {
    id: 'start-grading',
    view: 'setup-tasks',
    targets: ['result-fields', 'start-grading'],
    title: 'Ergebnisfelder und Start',
    body: 'Optional markieren Sie auf Seite 1, wo Gesamtpunktzahl und Note beim Export eingetragen werden. Weitere Aufgaben legen Sie genauso an; für die Demo genügt eine. Klicken Sie auf „Korrektur starten“.',
    advanceOn: ['grading:open'],
  },
  {
    id: 'red-pen',
    view: 'grading',
    targets: ['red-pen'],
    title: 'Rotstift wählen',
    body: 'Capy-note zeigt Ihnen jetzt denselben Ausschnitt aller Schülerarbeiten nacheinander. Wählen Sie den Rotstift in der Werkzeugleiste.',
    advanceOn: ['grading:pen-selected'],
  },
  {
    id: 'annotate',
    view: 'grading',
    targets: ['grading-canvas'],
    title: 'Direkt auf der Arbeit korrigieren',
    body: 'Unterstreichen oder markieren Sie mit gedrückter Maustaste oder mit dem Stift etwas im Ausschnitt. Ein zweiter Klick auf den Rotstift schaltet ihn wieder aus.',
    advanceOn: ['grading:annotation-added'],
  },
  {
    id: 'points',
    view: 'grading',
    targets: ['points'],
    title: 'Punkte vergeben',
    body: 'Vergeben Sie 0 BE, die volle Punktzahl oder tippen Sie einen eigenen Wert ein. Halbe Punkte sind möglich.',
    advanceOn: ['grading:points-set'],
  },
  {
    id: 'maximize',
    view: 'grading',
    targets: ['maximize'],
    title: 'Korrekturfeld maximieren',
    body: 'Mit diesem Knopf oder der Taste F blenden Sie Kopfbereich und Seitenleisten aus; der Ausschnitt nutzt dann die ganze Fläche. F oder Esc schaltet zurück. Probieren Sie es aus und klicken Sie dann auf „Weiter“.',
    manual: true,
  },
  {
    id: 'next-student',
    view: 'grading',
    targets: ['next-student'],
    title: 'Zur nächsten Schülerarbeit',
    body: 'Mit „Weiter“ erscheint derselbe Ausschnitt bei der nächsten Schülerarbeit. Nach der letzten folgt die nächste Aufgabe.',
    advanceOn: ['grading:next'],
  },
  {
    id: 'review-export',
    view: 'grading',
    targets: ['review', 'results'],
    title: 'Überprüfen und exportieren',
    body: 'Im Review vergleichen Sie alle Bewertungen einer Aufgabe, etwa alle Arbeiten mit 0 BE. Unter „Ergebnisse & Export“ sehen Sie Summen und Noten und speichern die korrigierten Arbeiten als PDF. Die Demo bleibt im Dashboard und lässt sich dort löschen.',
    // Im maximierten Korrekturfeld ist der Kopfbereich mit beiden Knöpfen ausgeblendet.
    bodyWhenHidden: 'Beenden Sie zuerst die Maximierung mit F oder Esc. Oben rechts finden Sie dann das Review, in dem Sie alle Bewertungen einer Aufgabe vergleichen, und „Ergebnisse & Export“ mit Summen, Noten und dem PDF-Export. Die Demo bleibt im Dashboard und lässt sich dort löschen.',
    final: true,
  },
];

// ---------- Zustand (außerhalb von React, damit er Ansichtswechsel überdauert) ----------
const readState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, index: 0 };
    const s = JSON.parse(raw);
    const index = Number.isInteger(s?.index) && s.index >= 0 && s.index < TOUR_STEPS.length ? s.index : 0;
    return { active: !!s?.active, index };
  } catch {
    return { active: false, index: 0 };
  }
};

let state = readState();
const listeners = new Set();

const setState = (next) => {
  state = next;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach(l => l());
};

const indexOfStep = (id) => TOUR_STEPS.findIndex(s => s.id === id);

export const tour = {
  start() { setState({ active: true, index: 0 }); },
  stop() { setState({ active: false, index: 0 }); },
  next() {
    if (!state.active) return;
    if (state.index >= TOUR_STEPS.length - 1) { tour.stop(); return; }
    setState({ active: true, index: state.index + 1 });
  },
  // Meldet eine Aktion der App; passt sie zum aktuellen Schritt, geht es weiter (oder zurück).
  signal(event) {
    if (!state.active) return;
    const step = TOUR_STEPS[state.index];
    if (!step) return;
    if (step.advanceOn?.includes(event)) { tour.next(); return; }
    const backTo = step.backOn?.[event];
    if (backTo) {
      const i = indexOfStep(backTo);
      if (i >= 0) setState({ active: true, index: i });
    }
  },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot() { return state; },
};

export const useTour = () => useSyncExternalStore(tour.subscribe, tour.getSnapshot);

// ---------- Hilfsfunktionen für Ziele und Platzierung ----------
const findVisibleTarget = (name) => {
  const els = document.querySelectorAll(`[data-tour~="${name}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
};

// Bedienelemente, die das Hinweisfenster möglichst nicht verdecken soll (z. B. schwebende Leisten).
const findAvoidAreas = () => [...document.querySelectorAll('[data-tour-avoid]')]
  .map(el => el.getBoundingClientRect())
  .filter(r => r.width > 0 && r.height > 0);

const overlap = (a, b) => {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
};

const MARGIN = 12;

// Sucht eine Position für das Hinweisfenster nahe am ersten Ziel, ohne die Ziele zu verdecken.
const placePanel = (anchor, targets, avoid, size) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(size.w, vw - 2 * MARGIN);
  const h = size.h;
  const clampX = (x) => Math.max(MARGIN, Math.min(vw - w - MARGIN, x));
  const clampY = (y) => Math.max(MARGIN, Math.min(vh - h - MARGIN, y));
  const corners = [
    { left: vw - w - MARGIN, top: vh - h - MARGIN },
    { left: MARGIN, top: vh - h - MARGIN },
    { left: vw - w - MARGIN, top: MARGIN },
    { left: MARGIN, top: MARGIN },
  ];
  const candidates = [];
  if (anchor) {
    const cx = anchor.left + anchor.width / 2 - w / 2;
    const cy = anchor.top + anchor.height / 2 - h / 2;
    candidates.push({ left: clampX(cx), top: anchor.top + anchor.height + MARGIN });
    candidates.push({ left: clampX(cx), top: anchor.top - h - MARGIN });
    candidates.push({ left: anchor.left + anchor.width + MARGIN, top: clampY(cy) });
    candidates.push({ left: anchor.left - w - MARGIN, top: clampY(cy) });
  }
  candidates.push(...corners);
  const fits = (c) => c.left >= MARGIN - 0.5 && c.top >= MARGIN - 0.5 && c.left + w <= vw - MARGIN + 0.5 && c.top + h <= vh - MARGIN + 0.5;
  let best = null;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    if (!fits(c)) return;
    const box = { left: c.left, top: c.top, width: w, height: h };
    // Ziele zu verdecken wiegt schwer (das erste am meisten), andere Bedienleisten wenig;
    // bei sonst gleichwertigen Plätzen gewinnt der nächstgelegene.
    const hidden = targets.reduce((sum, r, j) => sum + overlap(box, r) * (j === 0 ? 4 : 1), 0);
    const covered = avoid.reduce((sum, r) => sum + overlap(box, r), 0);
    const distance = anchor ? Math.hypot(c.left + w / 2 - (anchor.left + anchor.width / 2), c.top + h / 2 - (anchor.top + anchor.height / 2)) : 0;
    const score = hidden * 10 + covered * 0.1 + distance + i * 0.01;
    if (score < bestScore) { bestScore = score; best = c; }
  });
  return { ...(best || corners[0]), width: w };
};

const rectKey = (r) => (r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '-');

// ---------- Komponente ----------
export function GuidedTour({ view, enabled = true, darkMode, onFinish }) {
  const t = useTour();
  const step = TOUR_STEPS[t.index];
  const visible = !!(enabled && t.active && step && step.view === view);
  const [rects, setRects] = useState([]);
  const [avoid, setAvoid] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const panelRef = useRef(null);

  // Ziele laufend nachführen: Werkzeugleisten sind verschiebbar, Dialoge kommen und gehen.
  useEffect(() => {
    if (!visible) { setRects([]); setAvoid([]); setModalOpen(false); return undefined; }
    let lastKey = '';
    const tick = () => {
      const found = step.targets.map(findVisibleTarget);
      const areas = findAvoidAreas();
      const modal = !!document.querySelector('[data-modal]');
      const key = found.map(rectKey).join('|') + '/' + areas.map(rectKey).join('|') + (modal ? 'M' : '') + `${window.innerWidth}x${window.innerHeight}`;
      if (key === lastKey) return;
      lastKey = key;
      setRects(found);
      setAvoid(areas);
      setModalOpen(modal);
    };
    tick();
    const id = window.setInterval(tick, 150);
    window.addEventListener('resize', tick);
    return () => { window.clearInterval(id); window.removeEventListener('resize', tick); };
  }, [visible, step]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = panelRef.current;
    const size = { w: 340, h: el?.offsetHeight || 190 };
    const present = rects.filter(Boolean);
    // Bei offenem Dialog nur eine Ecke wählen, die den Dialog in der Mitte frei lässt.
    const anchor = modalOpen ? null : (present[0] || null);
    const next = placePanel(anchor, modalOpen ? [] : present, modalOpen ? [] : avoid, size);
    setPos(p => (p && p.left === next.left && p.top === next.top && p.width === next.width ? p : next));
  }, [visible, rects, avoid, modalOpen, t.index]);

  if (!visible) return null;

  const total = TOUR_STEPS.length;
  const number = t.index + 1;
  const finish = () => { tour.stop(); onFinish?.(); };
  // Erst nach der ersten Messung entscheiden, ob die Ziele gerade ausgeblendet sind.
  const targetsHidden = rects.length === step.targets.length && rects.every(r => !r);
  const body = targetsHidden && step.bodyWhenHidden ? step.bodyWhenHidden : step.body;

  return (
    <>
      {!modalOpen && rects.filter(Boolean).map((r, i) => (
        <div
          key={`${step.id}-${i}`}
          className="fixed z-[89] pointer-events-none rounded-xl animate-pulse"
          style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8, boxShadow: '0 0 0 3px rgba(251,191,36,0.95), 0 0 22px 4px rgba(251,191,36,0.45)' }}
          aria-hidden="true"
        />
      ))}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="capy-tour-title"
        className={`fixed z-[90] rounded-2xl border shadow-2xl ${darkMode ? 'bg-gray-900 border-amber-500/60 text-white' : 'bg-white border-amber-400 text-gray-900'}`}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width ?? 340 }}
      >
        <div className="p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">Einführung · {number} von {total}</p>
              <h2 id="capy-tour-title" className="mt-1 font-semibold">{step.title}</h2>
            </div>
            <button
              type="button"
              onClick={() => tour.stop()}
              className={`p-1.5 rounded-lg ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              title="Einführung beenden"
              aria-label="Einführung beenden"
            >
              <X size={18} />
            </button>
          </div>
          <p className={`mt-2 text-sm leading-relaxed ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{body}</p>
          <div className="mt-4 flex items-center gap-3">
            <div className={`flex-1 h-1.5 overflow-hidden rounded-full ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${Math.round((number / total) * 100)}%` }} />
            </div>
            {step.manual && (
              <button type="button" onClick={() => tour.next()} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white inline-flex items-center gap-1">
                Weiter <ChevronRight size={16} />
              </button>
            )}
            {step.final && (
              <button type="button" onClick={finish} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white inline-flex items-center gap-1">
                <Check size={16} /> Fertig
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
