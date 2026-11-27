"use client";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { title, type Entry } from "@/lib/domain/library";
import type { JournalIndex } from "@/lib/domain/journal";
import {
  airedCount,
  debtLabel,
  localNumber,
  monday,
  moveDay,
  weekSchedule,
} from "@/lib/domain/schedule";
import { Cover } from "./cover";

export function WeekCalendar({
  entries,
  index,
  today,
  open,
}: {
  entries: Entry[];
  index: JournalIndex;
  today: string;
  open: (entry: Entry) => void;
}) {
  const [offset, setOffset] = useState(0);
  const start = moveDay(monday(today), offset * 7);
  const { days, undated, paused } = weekSchedule(entries, index.episodes, start, today);
  return (
    <section className="week-panel" aria-label="放送周表">
      <div className="week-heading">
        <div>
          <h1>放送周表</h1>
          <p>
            上海时间 · {start.replaceAll("-", ".")} — {days[6].date.slice(5).replace("-", ".")}
          </p>
        </div>
        <div className="week-controls">
          <button className="icon-btn" aria-label="上一周" onClick={() => setOffset((n) => n - 1)}>
            <ChevronLeft size={19} />
          </button>
          <button onClick={() => setOffset(0)} className="text-button">
            本周
          </button>
          <button className="icon-btn" aria-label="下一周" onClick={() => setOffset((n) => n + 1)}>
            <ChevronRight size={19} />
          </button>
        </div>
      </div>
      <div className="week-grid">
        {days.map((day, i) => (
          <section
            key={day.date}
            aria-label={"周" + "一二三四五六日"[i] + " " + day.date}
            aria-current={day.date === today ? "date" : undefined}
            className={"week-day" + (day.date === today ? " is-today" : "")}
          >
            <header>
              <div>
                <strong>周{"一二三四五六日"[i]}</strong>
                <time dateTime={day.date}>{day.date.slice(5).replace("-", "/")}</time>
              </div>
              {day.date === today && <b>今日</b>}
            </header>
            {!day.slots.length && <p className="no-slot">暂无排期</p>}
            {day.slots.map((s) => (
              <button className="week-slot" key={s.entry.id} onClick={() => open(s.entry)}>
                <span className="slot-cover">
                  <Cover url={s.entry.cover_url} name={title(s.entry)} />
                </span>
                <span className="slot-text">
                  <strong>{title(s.entry)}</strong>
                  <small>
                    {s.estimated
                      ? "预计更新"
                      : s.episodes.map((ep) => "第 " + localNumber(ep) + " 集").join("、")}
                  </small>
                  <span className="debt">
                    {debtLabel(airedCount(s.entry, index.episodes[s.entry.id] ?? [], today))}
                  </span>
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
      {paused.length > 0 && (
        <section className="undated">
          <h2>
            <CalendarDays size={18} /> 本周停播
          </h2>
          {paused.map((e) => (
            <button key={e.id} onClick={() => open(e)}>
              {title(e)}
            </button>
          ))}
        </section>
      )}
      {undated.length > 0 && (
        <section className="undated">
          <h2>
            <CalendarDays size={18} /> 放送日待定
          </h2>
          {undated.map((e) => (
            <button key={e.id} onClick={() => open(e)}>
              {title(e)}{" "}
              <small>{debtLabel(airedCount(e, index.episodes[e.id] ?? [], today))}</small>
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
