import { ForbiddenView } from '@/components/common/status-page'

/** Rendered inside the shell when a page guard calls `forbidden()`. */
export default function Forbidden() {
  return <ForbiddenView />
}
