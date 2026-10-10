const Table = ({ columns, children, empty, loading }) => (
  <div className="overflow-x-auto rounded-ios-sm border border-white/10">
    <table className="w-full text-sm">
      <thead className="bg-white/5">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={`px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {loading ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-400">
              Memuat data...
            </td>
          </tr>
        ) : (
          children
        )}
      </tbody>
    </table>
    {!loading && empty && (
      <div className="px-4 py-10 text-center text-sm text-slate-400">{empty}</div>
    )}
  </div>
);

export default Table;
