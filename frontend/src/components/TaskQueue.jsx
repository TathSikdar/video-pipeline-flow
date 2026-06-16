import { TaskItem } from './TaskItem';

export function TaskQueue({ tasks }) {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-white mb-4 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>Queue</h2>

      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </div>
  );
}
