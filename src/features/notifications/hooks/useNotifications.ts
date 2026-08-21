import { useEffect, useState } from 'react'
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  clearAll,
  subscribe,
  type Notification,
} from '../lib/notificationStore'

/** Live view of the singleton notification log — re-renders whenever a task completes. */
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>(() => getNotifications())

  useEffect(() => {
    return subscribe(() => setNotifications(getNotifications()))
  }, [])

  return { notifications, markAllRead, markRead, clearAll }
}

/** Lighter-weight hook for just the unread count — what the Sidebar badge needs. */
export function useUnreadNotificationCount() {
  const [count, setCount] = useState(() => getUnreadCount())

  useEffect(() => {
    return subscribe(() => setCount(getUnreadCount()))
  }, [])

  return count
}
