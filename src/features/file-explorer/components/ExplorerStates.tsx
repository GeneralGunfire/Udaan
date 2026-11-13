import { motion } from 'framer-motion'
import { duration, ease } from '@/shared/lib/motion'
import { FolderIcon, SearchIcon } from '@/shared/icons'

export function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        animate={{ opacity: [0.4, 0.9, 0.4] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        className="text-text-tertiary flex flex-col items-center gap-2"
      >
        <FolderIcon width={28} height={28} />
        <span className="text-xs">Reading folder…</span>
      </motion.div>
    </div>
  )
}

export function EmptyFolderState({ searching }: { searching?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: duration.standard, ease: ease.standard }}
      className="flex flex-1 flex-col items-center justify-center gap-2"
    >
      {searching ? (
        <SearchIcon width={28} height={28} className="text-text-tertiary" />
      ) : (
        <FolderIcon width={28} height={28} className="text-text-tertiary" />
      )}
      <p className="text-text-secondary text-sm">
        {searching ? 'No matches found' : 'This folder is empty'}
      </p>
    </motion.div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-text-secondary text-sm">Couldn't read this folder</p>
      <p className="text-text-tertiary max-w-md text-xs">{message}</p>
    </div>
  )
}
