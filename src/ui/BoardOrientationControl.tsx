interface BoardOrientationOption<T extends string> {
  value: T
  label: string
}

interface BoardOrientationControlProps<T extends string> {
  label: string
  value: T
  options: readonly BoardOrientationOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/** 棋盤方向共用二選一；資料座標不在此轉換，只交由 Board.bottom／tabletop 顯示。 */
export default function BoardOrientationControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: BoardOrientationControlProps<T>) {
  return (
    <div
      className={`board-orientation-control ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      <span className="board-orientation-label" aria-hidden="true">
        {label}
      </span>
      <div className="board-orientation-options">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              <span className="board-orientation-dot" aria-hidden="true" />
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
