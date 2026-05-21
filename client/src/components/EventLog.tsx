import { EventLogEntry } from "../types";

interface EventLogProps {
  entries: EventLogEntry[];
  maxEntries?: number;
}

export function EventLog({ entries, maxEntries = 10 }: EventLogProps) {
  const displayEntries = entries.slice(-maxEntries);

  return (
    <div
      style={{
        padding: "1rem",
        background: "#222",
        border: "1px solid #666",
        borderRadius: "4px",
        maxHeight: "300px",
        overflowY: "auto",
        fontFamily: "monospace",
        fontSize: "0.75rem",
      }}
    >
      <div style={{ marginBottom: "0.5rem", fontWeight: "bold" }}>イベントログ</div>
      {displayEntries.length === 0 ? (
        <div style={{ color: "#999" }}>No events yet</div>
      ) : (
        displayEntries.map((entry, index) => (
          <div key={index} style={{ marginBottom: "0.25rem", color: "#aaa" }}>
            <span style={{ color: "#888" }}>
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>{" "}
            <span style={{ color: "#0a0" }}>[{entry.type}]</span>{" "}
            <span>{entry.message}</span>
          </div>
        ))
      )}
    </div>
  );
}
