import React, { useRef, useState } from 'react';

interface KeypadJpProps {
  mode: '50on' | 'swipe';
  onModeChange: (mode: '50on' | 'swipe') => void;
  onInputChar: (ch: string) => void;
  onMutateLastChar: () => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
}

// 50-on table columns (right to left: わ..あ)
const GOJUON_COLUMNS: (string | null)[][] = [
  ['わ', 'を', 'ん', 'ー', '゛゜小'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['や', null, 'ゆ', null, 'よ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['あ', 'い', 'う', 'え', 'お'],
];

interface FlickKeyDef {
  center: string;
  left?: string;
  up?: string;
  right?: string;
  down?: string;
}

const FLICK_KEYS: FlickKeyDef[] = [
  { center: 'あ', left: 'い', up: 'う', right: 'え', down: 'お' },
  { center: 'か', left: 'き', up: 'く', right: 'け', down: 'こ' },
  { center: 'さ', left: 'し', up: 'す', right: 'せ', down: 'そ' },
  { center: 'た', left: 'ち', up: 'つ', right: 'て', down: 'と' },
  { center: 'な', left: 'に', up: 'ぬ', right: 'ね', down: 'の' },
  { center: 'は', left: 'ひ', up: 'ふ', right: 'へ', down: 'ほ' },
  { center: 'ま', left: 'み', up: 'む', right: 'め', down: 'も' },
  { center: 'や', up: 'ゆ', down: 'よ' },
  { center: 'ら', left: 'り', up: 'る', right: 'れ', down: 'ろ' },
];

export const KeypadJp: React.FC<KeypadJpProps> = ({
  mode,
  onModeChange,
  onInputChar,
  onMutateLastChar,
  onBackspace,
  onClear,
  onSubmit,
}) => {
  const [activeFlick, setActiveFlick] = useState<{
    key: FlickKeyDef;
    selected: string;
  } | null>(null);

  const flickStartRef = useRef<{
    x: number;
    y: number;
    key: FlickKeyDef;
  } | null>(null);

  const resolveFlickChar = (def: FlickKeyDef, dx: number, dy: number): string => {
    const threshold = 18;
    if (Math.hypot(dx, dy) < threshold) return def.center;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0 && def.left) return def.left;
      if (dx > 0 && def.right) return def.right;
    } else {
      if (dy < 0 && def.up) return def.up;
      if (dy > 0 && def.down) return def.down;
    }
    return def.center;
  };

  const handleFlickDown = (def: FlickKeyDef, e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    flickStartRef.current = { x: e.clientX, y: e.clientY, key: def };
    setActiveFlick({ key: def, selected: def.center });
  };

  const handleFlickMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = flickStartRef.current;
    if (!st) return;
    const ch = resolveFlickChar(st.key, e.clientX - st.x, e.clientY - st.y);
    setActiveFlick({ key: st.key, selected: ch });
  };

  const handleFlickUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = flickStartRef.current;
    if (!st) return;
    const ch = resolveFlickChar(st.key, e.clientX - st.x, e.clientY - st.y);
    flickStartRef.current = null;
    setActiveFlick(null);
    onInputChar(ch);
  };

  const WA_FLICK_KEY: FlickKeyDef = { center: 'わ', left: 'を', up: 'ん', right: 'ー' };

  return (
    <div className="keypad-jp-wrap">
      <div className="keypad-toolbar">
        <div className="keypad-mode-tabs">
          <button
            type="button"
            className={mode === '50on' ? 'active' : ''}
            onClick={() => onModeChange('50on')}
          >
            五十音
          </button>
          <button
            type="button"
            className={mode === 'swipe' ? 'active' : ''}
            onClick={() => onModeChange('swipe')}
          >
            フリック
          </button>
        </div>
        <div className="keypad-edit-actions">
          <button type="button" className="keypad-act-btn" onClick={onBackspace}>
            ⌫ 1字消す
          </button>
          <button type="button" className="keypad-act-btn" onClick={onClear}>
            全消去
          </button>
          <button type="button" className="keypad-submit-btn" onClick={onSubmit}>
            判定する
          </button>
        </div>
      </div>

      {mode === '50on' ? (
        <div className="keypad-50on-grid">
          {GOJUON_COLUMNS.map((col, cIdx) => (
            <div key={cIdx} className="keypad-50on-col">
              {col.map((cell, rIdx) => {
                if (!cell) {
                  return <div key={rIdx} className="keypad-50on-spacer" />;
                }
                if (cell === '゛゜小') {
                  return (
                    <button
                      key={cell}
                      type="button"
                      className="keypad-50on-key keypad-mod-key"
                      onClick={onMutateLastChar}
                    >
                      ゛゜小
                    </button>
                  );
                }
                return (
                  <button
                    key={cell}
                    type="button"
                    className="keypad-50on-key"
                    onClick={() => onInputChar(cell)}
                  >
                    {cell}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="keypad-flick-wrap">
          {activeFlick && (
            <div className="flick-preview-bar">
              <span>{activeFlick.key.left ?? '·'}</span>
              <span>{activeFlick.key.up ?? '·'}</span>
              <strong className="flick-preview-active">{activeFlick.selected}</strong>
              <span>{activeFlick.key.right ?? '·'}</span>
              <span>{activeFlick.key.down ?? '·'}</span>
            </div>
          )}
          <div className="keypad-flick-grid">
            {FLICK_KEYS.map((def) => (
              <button
                key={def.center}
                type="button"
                className="keypad-flick-key"
                onPointerDown={(e) => handleFlickDown(def, e)}
                onPointerMove={handleFlickMove}
                onPointerUp={handleFlickUp}
                onPointerCancel={() => {
                  flickStartRef.current = null;
                  setActiveFlick(null);
                }}
              >
                <span className="flick-main">{def.center}</span>
                <span className="flick-hints">
                  {[def.left, def.up, def.right, def.down].filter(Boolean).join('')}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="keypad-flick-key keypad-mod-key"
              onClick={onMutateLastChar}
            >
              <span className="flick-main">゛゜大小</span>
            </button>
            <button
              type="button"
              className="keypad-flick-key"
              onPointerDown={(e) => handleFlickDown(WA_FLICK_KEY, e)}
              onPointerMove={handleFlickMove}
              onPointerUp={handleFlickUp}
              onPointerCancel={() => {
                flickStartRef.current = null;
                setActiveFlick(null);
              }}
            >
              <span className="flick-main">わ</span>
              <span className="flick-hints">をんー</span>
            </button>
            <button
              type="button"
              className="keypad-flick-key keypad-bs-key"
              onClick={onBackspace}
            >
              <span className="flick-main">⌫ 削除</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
