import { useMemo } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';

export const useCalendarGrid = (currentDate: Date) => {
  return useMemo(() => {
    const mStart = startOfMonth(currentDate);
    const mEnd = endOfMonth(mStart);
    const sDate = startOfWeek(mStart);
    const eDate = endOfWeek(mEnd);

    return {
      monthStart: mStart,
      startDate: sDate,
      endDate: eDate,
      days: eachDayOfInterval({ start: sDate, end: eDate })
    };
  }, [currentDate]);
};
