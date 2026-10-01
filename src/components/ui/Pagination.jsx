import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

const Pagination = ({ pagination, onChange }) => {
  if (!pagination || pagination.total_pages <= 1) return null;

  const { page, total_pages: totalPages, total, limit } = pagination;
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between mt-4 text-sm">
      <span className="text-slate-400">
        Menampilkan {start}-{end} dari {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="neutral"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="px-2 text-slate-300">
          {page} / {totalPages}
        </span>
        <Button
          variant="neutral"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
};

export default Pagination;
