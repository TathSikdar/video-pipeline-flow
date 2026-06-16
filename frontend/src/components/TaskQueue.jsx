import { TaskItem } from './TaskItem';

export function TaskQueue({ tasks, title, pulseId, onRemove }) {
  if (!tasks || tasks.length === 0) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-white/90 px-2 tracking-wide uppercase text-sm border-b border-gray-800 pb-2">
        {title} ({tasks.length})
      </h2>
      <div className="space-y-4">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} pulse={task.id === pulseId} onRemove={onRemove} />
        ))}
      </div>
    </div>
  );
}
