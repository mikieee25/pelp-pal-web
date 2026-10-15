import type { MouseEventHandler, ReactNode } from 'react';
import {
  Alert,
  Box,
  ButtonBase,
  Divider,
  Paper,
  Stack,
  Typography,
  type AlertProps,
  type PaperProps,
} from '@mui/material';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import HourglassTopRounded from '@mui/icons-material/HourglassTopRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import { designTokens } from '@/theme/tokens';

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Box className={className} sx={{ width: '100%', maxWidth: designTokens.layout.pageWidth, mx: 'auto', px: { xs: 4, sm: 6 }, py: { xs: 4, md: 8 } }}>
      {children}
    </Box>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ xs: 'stretch', sm: 'flex-start' }} justifyContent="space-between">
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h1" variant="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 1 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Box sx={{ flexShrink: 0, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}>{actions}</Box>}
    </Stack>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography component="h2" variant="h2">{title}</Typography>
        {actions}
      </Stack>
      <Divider sx={{ mb: 3 }} />
      {children}
    </Box>
  );
}

type SurfaceProps = Omit<PaperProps, 'elevation' | 'variant'> & { 'data-testid'?: string };

export function Surface({ children, sx, 'data-testid': testId, ...props }: SurfaceProps) {
  return <Paper elevation={0} variant="outlined" data-testid={testId} {...props} sx={[{ borderRadius: `${designTokens.radius.md}px`, bgcolor: 'background.paper' }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>{children}</Paper>;
}

export function ListRow({
  leading,
  primary,
  secondary,
  trailing,
  chevron = false,
  onClick,
  'aria-label': ariaLabel,
}: {
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  'aria-label'?: string;
}) {
  const content = (
    <Stack direction="row" spacing={3} alignItems="center" sx={{ minHeight: 56, width: '100%', minWidth: 0 }}>
      {leading && <Box sx={{ flexShrink: 0, display: 'grid', placeItems: 'center' }}>{leading}</Box>}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{primary}</Typography>
        {secondary && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{secondary}</Typography>}
      </Box>
      {trailing && <Box sx={{ flexShrink: 0 }}>{trailing}</Box>}
      {chevron && <ChevronRightRounded aria-hidden color="action" />}
    </Stack>
  );
  return onClick
    ? <ButtonBase onClick={onClick} aria-label={ariaLabel} sx={{ display: 'flex', width: '100%', px: 2, textAlign: 'left', borderRadius: `${designTokens.radius.sm}px`, '&:focus-visible': { outline: `2px solid ${designTokens.colors.primary}`, outlineOffset: 2 } }}>{content}</ButtonBase>
    : <Box aria-label={ariaLabel} sx={{ px: 2 }}>{content}</Box>;
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <Stack spacing={1}>
      <Typography variant="h2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

const statusStyles = {
  compliant: { label: 'Compliant', color: designTokens.colors.success, background: designTokens.colors.successSoft, Icon: CheckCircleOutlineRounded },
  nonCompliant: { label: 'Non-compliant', color: designTokens.colors.danger, background: designTokens.colors.dangerSoft, Icon: ErrorOutlineRounded },
  synced: { label: 'Synced', color: designTokens.colors.primary, background: designTokens.colors.primarySoft, Icon: CloudDoneOutlined },
  waiting: { label: 'Waiting', color: designTokens.colors.warning, background: designTokens.colors.warningSoft, Icon: HourglassTopRounded },
  attention: { label: 'Needs attention', color: designTokens.colors.danger, background: designTokens.colors.dangerSoft, Icon: ReportProblemOutlined },
  neutral: { label: 'Not available', color: designTokens.colors.muted, background: designTokens.colors.surfaceAlt, Icon: InfoOutlined },
} as const;

export function StatusBadge({ variant, label }: { variant: keyof typeof statusStyles; label?: string }) {
  const status = statusStyles[variant];
  const Icon = status.Icon;
  return (
    <Box component="span" role="status" aria-label={`${label ?? status.label} status`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2, py: 0.5, borderRadius: `${designTokens.radius.sm}px`, bgcolor: status.background, color: status.color, fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap' }}>
      <Icon aria-hidden fontSize="small" sx={{ fontSize: 16 }} />
      {label ?? status.label}
    </Box>
  );
}

export function EmptyState({ icon, message, action }: { icon: ReactNode; message: string; action?: ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ py: 6, textAlign: 'center' }}>
      <Box aria-hidden sx={{ color: 'text.secondary', display: 'grid', placeItems: 'center' }}>{icon}</Box>
      <Typography variant="body2" color="text.secondary">{message}</Typography>
      {action}
    </Stack>
  );
}

export function InlineNotice({ severity = 'info', children, ...props }: AlertProps) {
  return <Alert severity={severity} {...props} sx={[{ py: 1, px: 2, borderRadius: `${designTokens.radius.sm}px`, '& .MuiAlert-icon': { py: 0.5 } }, ...(Array.isArray(props.sx) ? props.sx : props.sx ? [props.sx] : [])]}>{children}</Alert>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <Box component="footer" data-testid="action-bar" sx={{ position: { xs: 'sticky', md: 'static' }, bottom: 0, zIndex: 1, display: 'flex', gap: 2, bgcolor: 'background.paper', borderTop: { xs: `1px solid ${designTokens.colors.border}`, md: 0 }, p: { xs: 3, md: 0 }, pb: { xs: 'calc(12px + env(safe-area-inset-bottom))', md: 0 } }}>
      {children}
    </Box>
  );
}

export function KeyValueList({ items }: { items: readonly { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <Stack component="dl" divider={<Divider flexItem />} sx={{ m: 0 }}>
      {items.map(({ label, value, mono }) => (
        <Stack key={label} component="div" direction="row" spacing={3} justifyContent="space-between" alignItems="center" sx={{ py: 3, minWidth: 0 }}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
          <Typography component="dd" variant="body2" fontWeight={600} textAlign="right" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere', fontFamily: mono ? designTokens.typography.monoFontFamily : undefined, fontSize: mono ? `${designTokens.typography.monoSize}px` : undefined }}>{value}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}
