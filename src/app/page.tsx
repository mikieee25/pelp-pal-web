import {
  ArrowForward,
  CloudOff,
  LockOutlined,
  StorageOutlined,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import Image from "next/image";
import { AnimatedRoute } from '@/components/motion/animated-route';

export const revalidate = 3600;

export default function HomePage() {
  return (
    <AnimatedRoute>
      <Container
        maxWidth="lg"
        sx={{
          minHeight: "100vh",
          display: "grid",
          alignItems: "center",
          py: { xs: 5, md: 8 },
        }}
      >
      <Box
        component="main"
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
          gap: { xs: 4, md: 8 },
          alignItems: "center",
        }}
      >
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ position: "relative", width: { xs: 72, sm: 88 }, height: { xs: 72, sm: 88 }, flexShrink: 0 }}>
              <Image
                src="/icons/Energi.png"
                alt="Energi, the PELP Pal mascot"
                fill
                priority
                sizes="(max-width: 600px) 72px, 88px"
                style={{ objectFit: "contain" }}
              />
            </Box>
            <Box>
              <Typography component="p" variant="h5" fontWeight={800}>PELP Pal</Typography>
              <Typography variant="body2" color="text.secondary">Department of Energy inspection workspace</Typography>
            </Box>
          </Stack>
          <Chip
            label="OFFLINE-FIRST INSPECTION WORKSPACE"
            color="primary"
            variant="outlined"
            sx={{
              alignSelf: "flex-start",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          />
          <Stack spacing={2}>
            <Typography
              component="h1"
              variant="h2"
              sx={{
                maxWidth: 640,
                fontSize: { xs: "2.5rem", md: "4.25rem" },
                lineHeight: 1.05,
              }}
            >
              PELP Pal, ready when the field is.
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ maxWidth: 560, fontSize: { xs: "1.05rem", md: "1.2rem" } }}
            >
              Capture inspections, keep evidence nearby, and sync safely when an
              authorized device reconnects.
            </Typography>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button
              href="/enroll"
              variant="contained"
              size="large"
              endIcon={<ArrowForward />}
              sx={{ minHeight: 48 }}
            >
              Enroll this browser
            </Button>
            <Button
              href="/login"
              variant="outlined"
              size="large"
              sx={{ minHeight: 48 }}
            >
              Local login
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Enrollment requires a current code issued for this device. Login
            works offline after account credentials have been synchronized.
          </Typography>
          <Stack
            component="section"
            aria-label="Official Department of Energy branding"
            direction="row"
            spacing={{ xs: 2, sm: 3 }}
            alignItems="center"
            sx={{ pt: 1 }}
          >
            <Box sx={{ position: "relative", width: { xs: 64, sm: 78 }, height: { xs: 64, sm: 78 }, flexShrink: 0 }}>
              <Image
                src="/icons/doe_logo_official.png"
                alt="Department of Energy Philippines official seal"
                fill
                sizes="(max-width: 600px) 64px, 78px"
                style={{ objectFit: "contain" }}
              />
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ position: "relative", width: { xs: 78, sm: 96 }, height: { xs: 72, sm: 84 }, flexShrink: 0 }}>
              <Image
                src="/icons/Bagong Pilipinas.png"
                alt="Bagong Pilipinas logo"
                fill
                sizes="(max-width: 600px) 78px, 96px"
                style={{ objectFit: "contain" }}
              />
            </Box>
          </Stack>
        </Stack>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, md: 4 },
            border: 1,
            borderColor: "divider",
            borderRadius: 3,
          }}
        >
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  display: "grid",
                  placeItems: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                }}
              >
                <StorageOutlined />
              </Box>
              <Stack spacing={0.25}>
                <Typography variant="h6">
                  Built for unreliable signal
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Your local workspace is the working copy.
                </Typography>
              </Stack>
            </Stack>
            <Divider />
            <StatusRow
              icon={<CloudOff />}
              title="Offline data stays on this browser"
              detail="Drafts and pending work remain available without a connection."
            />
            <StatusRow
              icon={<LockOutlined />}
              title="Access follows device enrollment"
              detail="Catalog scope and sync permissions come from the authorized device."
            />
          </Stack>
        </Paper>
      </Box>
      </Container>
    </AnimatedRoute>
  );
}

function StatusRow({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box sx={{ color: "primary.main", pt: 0.25 }}>{icon}</Box>
      <Stack spacing={0.25}>
        <Typography variant="subtitle1" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {detail}
        </Typography>
      </Stack>
    </Stack>
  );
}
