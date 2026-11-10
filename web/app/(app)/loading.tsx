export default function Caricamento() {
  return (
    <div role="status" aria-label="Caricamento in corso">
      <div className="skeleton mb-6 h-7 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
      <div className="skeleton mt-3 h-64" />
    </div>
  );
}
