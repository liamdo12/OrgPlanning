"use client";

import { useState } from "react";
import {
  AppBackground,
  Avatar,
  BottomTabBar,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  FilterChip,
  GlassCard,
  GlassPanel,
  Input,
  ListRow,
  ListStack,
  NAV_ICONS,
  PageHeader,
  Pill,
  ROLES,
  SearchButton,
  SearchOption,
  SearchPanelGroup,
  SearchPill,
  Select,
  Sheet,
  Skeleton,
  SkeletonRows,
  StatusBadge,
  Stepper,
  Swatch,
  Switch,
  SectionNav,
  Textarea,
  Toast,
  ToastRegion,
  Toolbar,
  type Column,
  type Role,
} from "@occasion/ui";

/**
 * Every component, every state, in all three role themes.
 *
 * This is the comparison surface for the prototype: one page where a token can
 * be checked against `design/Event Marketplace Glass.dc.html` without loading a
 * screen that also needs a database. It is not product UI and is not reachable
 * on the production tier.
 *
 * The data is obviously fake and says so — these rows exist to exercise a
 * layout, not to stand in for anything. Nothing here calls the domain.
 */

type DemoOrder = {
  id: string;
  who: string;
  total: string;
  payment: string;
  state: string;
  tone: "success" | "warn" | "danger" | "neutral";
};

/** Shaped like the prototype's `adminOrders`, line 2599. */
const ORDERS: DemoOrder[] = [
  {
    id: "TO-4188",
    who: "Bloom & Co · Sarah's 30th",
    total: "C$1,039.00",
    payment: "Deposit paid",
    state: "Balance due",
    tone: "danger",
  },
  {
    id: "TO-4191",
    who: "Kimchi Kart · Corporate launch",
    total: "C$2,260.00",
    payment: "Paid in full",
    state: "Completed",
    tone: "success",
  },
  {
    id: "TO-4207",
    who: "Lens Studio · Baby shower",
    total: "C$1,850.00",
    payment: "Deposit paid",
    state: "Awaiting vendor",
    tone: "warn",
  },
  {
    id: "TO-4160",
    who: "Terrace Rentals · Leslieville",
    total: "C$418.50",
    payment: "Refunded",
    state: "Cancelled",
    tone: "neutral",
  },
];

/** The five tracks from the prototype's admin orders grid, line 1798. */
const COLUMNS: ReadonlyArray<Column<DemoOrder>> = [
  {
    key: "id",
    header: "Order",
    width: "0.8fr",
    mobile: "title",
    render: (row) => <span className="font-bold">{row.id}</span>,
  },
  {
    key: "who",
    header: "Vendor / event",
    width: "1.5fr",
    mobile: "body",
    render: (row) => row.who,
  },
  {
    key: "total",
    header: "Total",
    width: "0.8fr",
    mobile: "meta",
    render: (row) => <span className="font-bold">{row.total}</span>,
  },
  {
    key: "payment",
    header: "Payment",
    width: "1fr",
    mobile: "meta",
    render: (row) => <span className="text-body">{row.payment}</span>,
  },
  {
    key: "state",
    header: "State",
    width: "0.9fr",
    mobile: "badge",
    render: (row) => <StatusBadge tone={row.tone}>{row.state}</StatusBadge>,
  },
];

const PEOPLE = [
  { name: "Sarah Mensah", email: "sarah@example.ca", status: "Active", tone: "success" as const },
  { name: "Dae Kim", email: "dae@kimchikart.ca", status: "Pending", tone: "warn" as const },
  {
    name: "Bea Varga",
    email: "bea@terracerentals.ca",
    status: "Suspended",
    tone: "neutral" as const,
  },
];

const SECTIONS = [
  { id: "vendors", label: "Vendors", badge: 2 },
  { id: "users", label: "Users" },
  { id: "orders", label: "Orders" },
  { id: "automations", label: "Automations" },
];

export function KitchenSink() {
  const [role, setRole] = useState<Role>("admin");
  const [tab, setTab] = useState("orders");
  const [filter, setFilter] = useState("All accounts");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchField, setSearchField] = useState<string | undefined>(undefined);
  const [category, setCategory] = useState("Any service");
  const [guests, setGuests] = useState(60);
  const [toasts, setToasts] = useState<Array<{ id: number; tone: "success" | "danger" }>>([]);

  return (
    <AppBackground role={role}>
      <main className="mx-auto max-w-5xl px-4 py-10 pb-[140px] desk:pb-16">
        <PageHeader
          title="Kitchen sink"
          blurb="Every primitive in the design system, in every state it ships with. Switch the role to check that a theme is three variables and nothing else."
          actions={
            <FilterBar>
              {ROLES.map((candidate) => (
                <FilterChip
                  key={candidate}
                  active={role === candidate}
                  onSelect={() => setRole(candidate)}
                >
                  {candidate}
                </FilterChip>
              ))}
            </FilterBar>
          }
        />

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button intent="primary">Approve</Button>
            <Button intent="secondary">Message</Button>
            <Button intent="ghost">Resend email</Button>
            <Button intent="danger">Suspend</Button>
            {/*
              The two disabled treatments, side by side on purpose. A primary
              button takes a colour pair and stops being faded, because fading
              it renders the label at 2.32:1; every other variant keeps the
              fade, which is legible on them. Seeing both is the only way to
              notice if one ever starts behaving like the other.
            */}
            <Button intent="primary" disabled>
              Disabled primary
            </Button>
            <Button intent="secondary" disabled>
              Disabled secondary
            </Button>
            <Button intent="ghost" disabled>
              Disabled ghost
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button intent="secondary" size="sm">
              Small
            </Button>
            <Button intent="secondary" size="md">
              Medium
            </Button>
          </div>
          <div className="mt-3 max-w-sm">
            <Button intent="primary" size="lg">
              Large, full width
            </Button>
          </div>
        </Section>

        <Section title="Status">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Active</StatusBadge>
            <StatusBadge tone="warn">Pending</StatusBadge>
            <StatusBadge tone="danger">Balance due</StatusBadge>
            <StatusBadge tone="neutral">Unverified</StatusBadge>
            <Pill tone="danger">GET QUOTES</Pill>
          </div>
        </Section>

        <Section title="Filters and section links">
          <FilterBar className="mb-4">
            {["All accounts", "Customers", "Vendor staff", "Suspended"].map((label) => (
              <FilterChip key={label} active={filter === label} onSelect={() => setFilter(label)}>
                {label}
              </FilterChip>
            ))}
          </FilterBar>
          <SectionNav
            items={[
              ...SECTIONS.map((section) => ({ ...section, onSelect: () => setTab(section.id) })),
              // Visibly deferred: shown, inert, and never a link. Both tab
              // renderers carry this state, and it is here because a screen
              // that is planned and not built is a thing the product says out
              // loud rather than leaves out of the row.
              {
                id: "deferred",
                label: "Not built yet",
                disabled: true,
                title: "This screen is planned. It does not exist yet.",
              },
            ]}
            activeId={tab}
            label="Admin sections"
          />
        </Section>

        <Section
          title="Search"
          blurb="The header control in both its forms. The pill shows from 1080px; the button replaces it below that."
        >
          <div className="flex max-w-xl flex-col gap-4">
            <SearchPill
              activeKey={searchField}
              onSubmit={() => setSearchField(undefined)}
              segments={[
                {
                  key: "what",
                  label: "What",
                  value: category,
                  grow: true,
                  onOpen: () => setSearchField("what"),
                },
                {
                  key: "where",
                  label: "Where",
                  value: "Liberty Village",
                  onOpen: () => setSearchField("where"),
                },
                {
                  key: "when",
                  label: "When",
                  value: "Mar 20",
                  onOpen: () => setSearchField("when"),
                },
                {
                  key: "guests",
                  label: "Guests",
                  value: String(guests),
                  onOpen: () => setSearchField("guests"),
                },
              ]}
            />

            <SearchButton
              value={category}
              summary={`Liberty Village · Mar 20 · ${guests} guests`}
              expanded={searchField !== undefined}
              onOpen={() => setSearchField(searchField ? undefined : "what")}
            />

            <GlassPanel className="p-5">
              <SearchPanelGroup legend="What do you need">
                <div className="flex flex-wrap gap-2">
                  {["Any service", "Flowers", "Catering", "Cakes", "Photography"].map((label) => (
                    <SearchOption
                      key={label}
                      label={label}
                      selected={category === label}
                      onSelect={() => setCategory(label)}
                    />
                  ))}
                </div>
              </SearchPanelGroup>
            </GlassPanel>
          </div>
        </Section>

        <Section
          title="Steppers and swatches"
          blurb="A stepper announces its value as it changes, and refuses to leave its bounds. A swatch takes a tone and a size, or hashes both from a name."
        >
          <div className="flex flex-wrap items-center gap-6">
            <Stepper
              label="Guests"
              decrementLabel="Fewer guests"
              incrementLabel="More guests"
              value={guests}
              min={5}
              max={500}
              step={5}
              onChange={setGuests}
            />
            {/* At the bounds, so the disabled ends are visible without anyone
                having to press a button thirty times to find them. */}
            <Stepper
              label="At the minimum"
              decrementLabel="Fewer"
              incrementLabel="More"
              value={5}
              min={5}
              max={500}
              step={5}
              onChange={() => undefined}
            />
            <Stepper
              label="At the maximum"
              decrementLabel="Fewer"
              incrementLabel="More"
              value={500}
              min={5}
              max={500}
              step={5}
              onChange={() => undefined}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Swatch name="Bloom & Co" />
            <Swatch name="Maple & Thyme" />
            <Swatch name="Anything" tone="#B4C6BA" />
            <Swatch name="Anything" tone={["#EADFD1", "#D6BFA8"]} />
            <Swatch name="Anything" tone={["#D9E2DB", "#B4C6BA"]} size={64} />
          </div>
        </Section>

        <Section title="Surfaces">
          <div className="grid gap-4 desk:grid-cols-3">
            <GlassPanel className="p-5">
              <p className="m-0 text-[17px] font-bold">Glass panel</p>
              <p className="mt-1 mb-0 text-row text-body">A page section. Radius 24.</p>
            </GlassPanel>
            <GlassCard>
              <p className="m-0 text-[15px] font-bold">Glass card</p>
              <p className="mt-1 mb-0 text-row text-body">A card in a grid. Radius 22.</p>
            </GlassCard>
            <GlassPanel className="bg-role p-5 text-surface">
              <p className="m-0 text-[17px] font-bold">Role fill</p>
              <p className="mt-1 mb-0 text-row opacity-80">The one solid surface.</p>
            </GlassPanel>
          </div>
        </Section>

        <Section title="Table" blurb="One column spec. A grid above 860px, cards below it.">
          <DataTable
            caption="Demo orders"
            columns={COLUMNS}
            rows={ORDERS}
            rowKey={(row) => row.id}
            onRowClick={() => setDialogOpen(true)}
            empty={<EmptyState title="No orders yet" />}
          />
        </Section>

        <Section title="List rows">
          <ListStack>
            {PEOPLE.map((person) => (
              <ListRow
                key={person.email}
                leading={<Avatar name={person.name} />}
                title={person.name}
                subtitle={person.email}
                trailing={
                  <>
                    <StatusBadge tone={person.tone}>{person.status}</StatusBadge>
                    <Button intent="ghost" size="sm">
                      Open
                    </Button>
                  </>
                }
              />
            ))}
          </ListStack>
        </Section>

        <Section title="Fields">
          <GlassPanel className="max-w-md p-5">
            <Input id="ks-email" label="Email" type="email" placeholder="sarah@example.ca" />
            <Input
              id="ks-broken"
              label="Email"
              defaultValue="not-an-address"
              error="Enter a valid email address."
            />
            <Select
              id="ks-role"
              label="Role"
              hint="Only two roles can be chosen by the account holder."
              options={[
                { value: "customer", label: "Customer" },
                { value: "vendor", label: "Vendor" },
              ]}
            />
            <Textarea id="ks-note" label="Internal note" placeholder="Why this was refunded" />
            <div className="grid gap-3">
              <Checkbox id="ks-check" label="My date is flexible by ±3 days" defaultChecked />
              <Switch id="ks-switch" label="Pause automatic balance charges" />
            </div>
          </GlassPanel>
        </Section>

        <Section title="Overlays and feedback">
          <div className="flex flex-wrap gap-3">
            <Button intent="secondary" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button intent="secondary" onClick={() => setSheetOpen(true)}>
              Open sheet
            </Button>
            <Button
              intent="secondary"
              onClick={() =>
                setToasts((current) => [...current, { id: Date.now(), tone: "success" }])
              }
            >
              Toast
            </Button>
            <Button
              intent="danger"
              onClick={() =>
                setToasts((current) => [...current, { id: Date.now(), tone: "danger" }])
              }
            >
              Alert toast
            </Button>
          </div>

          <div className="mt-6 grid gap-4 desk:grid-cols-2">
            <EmptyState
              title="No orders yet"
              blurb="When someone books a vendor, the order shows up here with its payment state."
              action={<Button intent="primary">Invite a vendor</Button>}
            />
            <div>
              <SkeletonRows rows={3} />
              <div className="mt-3 flex items-center gap-3">
                <Skeleton width="40px" height="40px" className="rounded-pill" />
                <Skeleton width="180px" />
              </div>
            </div>
          </div>
        </Section>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Suspend this account?"
          footer={
            <>
              <Button intent="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button intent="danger" onClick={() => setDialogOpen(false)}>
                Suspend
              </Button>
            </>
          }
        >
          <p className="m-0 text-[14px] text-body">
            They are signed out immediately and cannot sign back in. Existing orders are unaffected.
          </p>
        </Dialog>

        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Filters"
          footer={
            <Button intent="primary" onClick={() => setSheetOpen(false)}>
              Show results
            </Button>
          }
        >
          <FilterBar>
            {["Pending", "Approved", "Blocked"].map((label) => (
              <FilterChip key={label}>{label}</FilterChip>
            ))}
          </FilterBar>
        </Sheet>

        <ToastRegion>
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              tone={toast.tone}
              onDismiss={() =>
                setToasts((current) => current.filter((candidate) => candidate.id !== toast.id))
              }
            >
              {toast.tone === "danger"
                ? "That balance charge failed. The card was declined."
                : "Vendor approved. They can take bookings now."}
            </Toast>
          ))}
        </ToastRegion>
      </main>

      <BottomTabBar
        activeId={tab}
        items={[
          {
            id: "vendors",
            label: "Vendors",
            icon: NAV_ICONS.vendors,
            onSelect: () => setTab("vendors"),
          },
          { id: "users", label: "Users", icon: NAV_ICONS.users, onSelect: () => setTab("users") },
          {
            id: "orders",
            label: "Orders",
            icon: NAV_ICONS.orders,
            onSelect: () => setTab("orders"),
          },
          {
            id: "automations",
            label: "Automations",
            icon: NAV_ICONS.automations,
            onSelect: () => setTab("automations"),
          },
          // The same deferred state as the section links above. A phone is
          // where it matters most: the bar is the only navigation, so a tab
          // that leads nowhere has nothing beside it to recover from.
          {
            id: "deferred",
            label: "Calendar",
            icon: NAV_ICONS.calendar,
            disabled: true,
            title: "This screen is planned. It does not exist yet.",
          },
        ]}
      />
    </AppBackground>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <Toolbar>
        <div>
          <h2 className="m-0 text-[17px] font-bold">{title}</h2>
          {blurb ? <p className="m-0 text-row text-body">{blurb}</p> : null}
        </div>
      </Toolbar>
      {children}
    </section>
  );
}
