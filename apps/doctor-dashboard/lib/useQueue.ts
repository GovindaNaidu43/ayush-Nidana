import useSWR from 'swr'
import { getQueue, type QueueItem } from './apiClient'

const prototypeQueue: QueueItem[] = [
  {
    consultation_id: 'prototype-consultation-001',
    patient_id: 'prototype-patient-001',
    patient_name: 'Ananya Mehta',
    status: 'awaiting_review',
    red_flag_count: 0,
    created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    consultation_id: 'prototype-consultation-002',
    patient_id: 'prototype-patient-002',
    patient_name: 'Rohan Kapoor',
    status: 'priority_review',
    red_flag_count: 2,
    created_at: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
  },
]

export function useQueue() {
  const prototypeMode = process.env.NEXT_PUBLIC_PROTOTYPE_MODE === 'true'
  return useSWR<QueueItem[]>(
    prototypeMode ? 'prototype-operations/queue' : 'operations/queue',
    prototypeMode ? async () => prototypeQueue : getQueue,
    {
    refreshInterval: 5_000,
    },
  )
}
