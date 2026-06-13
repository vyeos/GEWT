import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Branch, Course } from "@/types";

/// The branch-grouped course picker body shared by the admission, outstanding,
/// promote, and students course comboboxes. Render it inside a PopoverContent;
/// each caller's onSelect closes its own popover and applies any side effects.
export function CourseGroups({
  groups,
  selectedCourseId,
  onSelect,
}: {
  groups: { branch: Branch; branchCourses: Course[] }[];
  selectedCourseId: string;
  onSelect: (courseId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
        No results found
      </div>
    );
  }

  return (
    <div className="flex divide-x">
      {groups.map(({ branch, branchCourses }) => (
        <div key={branch.id} className="min-w-40 flex-1 p-1">
          <div className="px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {branch.name}
          </div>
          {branchCourses.map((course) => (
            <button
              key={course.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                selectedCourseId === course.id && "bg-accent",
              )}
              onClick={() => onSelect(course.id)}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  selectedCourseId === course.id ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="truncate">{course.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
