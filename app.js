const RANKS = [
  { key: "staff", name: "Whitelist Staff", level: 1, canWarn: true, canRemoveWarnings: false, canManageRanks: false, canKick: false },
  { key: "admin", name: "Whitelist Admin", level: 2, canWarn: true, canRemoveWarnings: true, canManageRanks: false, canKick: false },
  { key: "manager", name: "Whitelist Manager", level: 3, canWarn: true, canRemoveWarnings: true, canManageRanks: true, canKick: true },
  { key: "management", name: "Whitelist Management", level: 4, canWarn: true, canRemoveWarnings: true, canManageRanks: true, canKick: true },
  { key: "owner", name: "Whitelist Owner", level: 5, canWarn: true, canRemoveWarnings: true, canManageRanks: true, canKick: true }
];

let sb = null;
let session = null;
let currentProfile = null;
let profiles = [];
let warnings = [];
let autoRefreshTimer = null;
let isLoadingAll = false;
const AUTO_REFRESH_INTERVAL_MS = 3000;

const titles = {
  dashboard: ["Dashboard", "Login with email and password."],
  warnings: ["Warning List", "Staff/Admin see active warnings only. Manager+ can see removed warnings."],
  give: ["Give Warning", "Submit new warnings for players."],
  staff: ["Whitelist List", "Owner can create staff accounts here."],
  ranks: ["Ranks", "Manage promotions, demotions, kicks, and password resets."]
};

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  renderRankSelects();
  renderRankInfoList();

  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || SUPABASE_URL.includes("PASTE_")) {
    document.getElementById("setupWarning").classList.remove("hidden");
    showToast("Supabase is not configured yet.");
    updateHeader();
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("giveWarningBtn").addEventListener("click", giveWarning);
  document.getElementById("exampleWarningBtn").addEventListener("click", fillExample);
  document.getElementById("refreshWarningsBtn").addEventListener("click", loadAll);
  document.getElementById("createStaffBtn").addEventListener("click", createStaff);
  document.getElementById("generatePasswordBtn").addEventListener("click", generatePassword);
  document.getElementById("warningSearch").addEventListener("input", renderWarnings);
  document.getElementById("uploadAvatarBtn").addEventListener("click", uploadMyAvatar);
  document.getElementById("removeAvatarBtn").addEventListener("click", removeMyAvatar);

  const result = await sb.auth.getSession();
  session = result.data.session;

  sb.auth.onAuthStateChange(async (_event, newSession) => {
    session = newSession;
    await loadAll();
    setupAutoRefresh();
  });

  await loadAll();
  setupAutoRefresh();
});

function setupTabs() {
  document.querySelectorAll(".nav button").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;

      document.querySelectorAll(".tab-page").forEach((page) => page.classList.remove("active"));
      document.querySelectorAll(".nav button").forEach((btn) => btn.classList.remove("active"));

      document.getElementById(tabId).classList.add("active");
      button.classList.add("active");

      document.getElementById("pageTitle").textContent = titles[tabId][0];
      document.getElementById("pageSub").textContent = titles[tabId][1];
    });
  });
}

function setupAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!session) {
    return;
  }

  autoRefreshTimer = setInterval(async () => {
    if (!session || !sb || document.hidden) {
      return;
    }

    await loadAll({ silent: true });
  }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function renderRankSelects() {
  const select = document.getElementById("newRank");
  select.innerHTML = RANKS.map(rank => `<option value="${rank.key}">${rank.name}</option>`).join("");
  select.value = "staff";
}

async function login() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    showToast("Type your email and password first.");
    return;
  }

  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showToast(error.message);
    return;
  }

  showToast("Logged in.");
}

async function logout() {
  if (!sb) return;
  await sb.auth.signOut();
  stopAutoRefresh();
  session = null;
  currentProfile = null;
  profiles = [];
  warnings = [];
  updateAll();
  showToast("Logged out.");
}

async function loadAll(options = {}) {
  const silent = !!options.silent;

  if (!sb || isLoadingAll) return;

  isLoadingAll = true;

  try {
    const sessionResult = await sb.auth.getSession();
    session = sessionResult.data.session;

    if (!session) {
      currentProfile = null;
      profiles = [];
      warnings = [];
      updateAll();
      return;
    }

    const userId = session.user.id;

    const profileResult = await sb
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileResult.error) {
      if (!silent) showToast(profileResult.error.message);
      return;
    }

    currentProfile = profileResult.data;

    const profilesResult = await sb
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (!profilesResult.error) {
      profiles = profilesResult.data || [];
    } else if (!silent) {
      showToast(profilesResult.error.message);
    }

    let warningsQuery = sb
      .from("warnings")
      .select("*")
      .order("created_at", { ascending: false });

    if (!canSeeRemovedWarnings()) {
      warningsQuery = warningsQuery.eq("active", true);
    }

    const warningsResult = await warningsQuery;

    if (!warningsResult.error) {
      warnings = warningsResult.data || [];
    } else if (!silent) {
      showToast(warningsResult.error.message);
    }

    updateAll();
  } finally {
    isLoadingAll = false;
  }
}

function updateAll() {
  updateHeader();
  renderStats();
  renderPermissionBoxes();
  renderWarnings();
  renderLatestWarnings();
  renderStaffList();
  renderRankManagementList();
}

function updateHeader() {
  const name = currentProfile?.display_name || currentProfile?.email || "Not logged in";
  const rank = getRank(currentProfile?.rank);
  const avatar = document.getElementById("staffAvatar");

  document.getElementById("staffName").textContent = name;
  document.getElementById("staffRank").textContent = currentProfile ? rank.name : "No Access";

  if (avatar) {
    avatar.innerHTML = avatarHtml(currentProfile, "staff-card-img");
  }

  renderProfilePicturePanel();
}

function renderProfilePicturePanel() {
  const panel = document.getElementById("profilePicturePanel");
  const preview = document.getElementById("profilePreview");

  if (!panel || !preview) return;

  panel.classList.toggle("hidden", !currentProfile);
  preview.innerHTML = avatarHtml(currentProfile, "profile-preview-img");
}

function avatarHtml(profile, className = "staff-avatar-img") {
  const name = profile?.display_name || profile?.email || "?";
  const letter = escapeHtml((name[0] || "?").toUpperCase());
  const url = profile?.avatar_url;

  if (url) {
    return `<img class="${className}" src="${escapeAttr(url)}" alt="${escapeAttr(name)} avatar" onerror="this.replaceWith(document.createTextNode('${letter}'))">`;
  }

  return letter;
}

async function uploadMyAvatar() {
  if (!currentProfile || !session) {
    showToast("Login first.");
    return;
  }

  const input = document.getElementById("avatarFileInput");
  const file = input.files && input.files[0];

  if (!file) {
    showToast("Choose an image file first.");
    return;
  }

  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

  if (!allowedTypes.includes(file.type)) {
    showToast("Only PNG, JPG, WebP, or GIF images are allowed.");
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    showToast("Avatar must be under 2 MB.");
    return;
  }

  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${currentProfile.id}/avatar-${Date.now()}.${extension}`;

  const uploadResult = await sb.storage
    .from("avatars")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type
    });

  if (uploadResult.error) {
    showToast(uploadResult.error.message);
    return;
  }

  const publicResult = sb.storage
    .from("avatars")
    .getPublicUrl(path);

  const publicUrl = publicResult.data.publicUrl;

  const rpcResult = await sb.rpc("set_my_avatar", {
    new_avatar_url: publicUrl
  });

  if (rpcResult.error) {
    showToast(rpcResult.error.message);
    return;
  }

  input.value = "";
  showToast("Avatar updated.");
  await loadAll();
}

async function removeMyAvatar() {
  if (!currentProfile || !session) {
    showToast("Login first.");
    return;
  }

  const rpcResult = await sb.rpc("set_my_avatar", {
    new_avatar_url: null
  });

  if (rpcResult.error) {
    showToast(rpcResult.error.message);
    return;
  }

  showToast("Avatar removed.");
  await loadAll();
}

function renderStats() {
  const active = warnings.filter(w => w.active).length;

  document.getElementById("totalWarnings").textContent = warnings.length;
  document.getElementById("activeWarnings").textContent = active;
  document.getElementById("staffCount").textContent = profiles.length;
  document.getElementById("rankStat").textContent = currentProfile ? getRank(currentProfile.rank).name.replace("Whitelist ", "") : "NO";
}

function renderPermissionBoxes() {
  const rank = getRank(currentProfile?.rank);

  document.getElementById("givePermission").innerHTML = currentProfile && rank.canWarn
    ? `<div class="success-notice">Access granted. You can give warnings as ${escapeHtml(rank.name)}.</div>`
    : `<div class="notice">Access denied. Login with a Whitelist Staff+ account first.</div>`;

  const createPanel = document.getElementById("createStaffPanel");
  if (createPanel) {
    createPanel.style.display = isOwner() ? "block" : "none";
  }

  document.getElementById("staffPermission").innerHTML = isOwner()
    ? `<div class="success-notice">Owner access granted. You can create staff accounts here.</div>`
    : `<div class="notice">Only Whitelist Owner can create staff accounts. Manager+ can still use rank controls if allowed.</div>`;
}

async function giveWarning() {
  const rank = getRank(currentProfile?.rank);

  if (!currentProfile || !rank.canWarn) {
    showToast("Access denied.");
    return;
  }

  const target = document.getElementById("targetName").value.trim();
  const reason = document.getElementById("warningReason").value.trim();

  if (!target || !reason) {
    showToast("Type the target name and reason.");
    return;
  }

  const { error } = await sb.from("warnings").insert({
    target_name: target,
    reason,
    staff_id: currentProfile.id,
    staff_name: currentProfile.display_name || currentProfile.email
  });

  if (error) {
    showToast(error.message);
    return;
  }

  document.getElementById("targetName").value = "";
  document.getElementById("warningReason").value = "";
  showToast("Warning added.");
  await loadAll();
}

function fillExample() {
  document.getElementById("targetName").value = "CoolPlayer123";
  document.getElementById("warningReason").value = "Breaking server rules after being told to stop.";
}

async function removeWarning(id) {
  const rank = getRank(currentProfile?.rank);

  if (!currentProfile || !rank.canRemoveWarnings) {
    showToast("Access denied. Your rank cannot remove warnings.");
    return;
  }

  const { error } = await sb
    .from("warnings")
    .update({
      active: false,
      removed_by: currentProfile.id,
      removed_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    showToast(error.message);
    return;
  }

  showToast("Warning marked as removed.");
  await loadAll();
}

function renderWarnings() {
  const container = document.getElementById("warningsList");
  const search = normalize(document.getElementById("warningSearch").value);

  let filtered = warnings;

  if (search) {
    filtered = warnings.filter(warning =>
      normalize(warning.target_name).includes(search) ||
      normalize(warning.reason).includes(search) ||
      normalize(warning.staff_name).includes(search)
    );
  }

  if (!filtered.length) {
    container.innerHTML = `<div class="item"><p>No warnings found.</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(warning => warningHtml(warning, true)).join("");
}

function renderLatestWarnings() {
  const container = document.getElementById("latestWarnings");
  const latest = warnings.slice(0, 5);

  if (!latest.length) {
    container.innerHTML = `<div class="item"><p>No warning records yet.</p></div>`;
    return;
  }

  container.innerHTML = latest.map(warning => warningHtml(warning, false)).join("");
}

function warningHtml(warning, showActions) {
  const status = warning.active
    ? `<span class="badge red">Active</span>`
    : `<span class="badge green">Removed</span>`;

  const removeButton = showActions && warning.active
    ? `<button class="mini-btn remove" onclick="removeWarning('${warning.id}')">Remove Warning</button>`
    : "";

  return `
    <div class="item">
      <div class="item-top">
        <h4>${escapeHtml(warning.target_name)}</h4>
        ${status}
      </div>
      <p><strong>Reason:</strong> ${escapeHtml(warning.reason)}</p>
      <p><strong>Staff:</strong> ${escapeHtml(warning.staff_name || "Unknown")} • <strong>Time:</strong> ${formatDate(warning.created_at)}</p>
      <div class="warning-actions">${removeButton}</div>
    </div>
  `;
}

async function createStaff() {
  if (!isOwner()) {
    showToast("Only Owner can create staff accounts.");
    return;
  }

  const email = document.getElementById("newEmail").value.trim();
  const displayName = document.getElementById("newDisplayName").value.trim();
  const password = document.getElementById("newPassword").value;
  const rank = document.getElementById("newRank").value;

  if (!email || !displayName || !password) {
    showToast("Fill in email, display name, and password.");
    return;
  }

  const { data, error } = await sb.functions.invoke("manage-staff", {
    body: {
      action: "create",
      email,
      display_name: displayName,
      password,
      rank
    }
  });

  if (error || data?.error) {
    showToast(data?.error || error.message);
    return;
  }

  document.getElementById("newEmail").value = "";
  document.getElementById("newDisplayName").value = "";
  document.getElementById("newPassword").value = "";

  showToast("Staff account created.");
  await loadAll();
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";

  for (let i = 0; i < 12; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  document.getElementById("newPassword").value = password;
  showToast("Generated password.");
}

async function changeStaffRank(profileId, newRank) {
  const { data, error } = await sb.functions.invoke("manage-staff", {
    body: {
      action: "set-rank",
      target_user_id: profileId,
      rank: newRank
    }
  });

  if (error || data?.error) {
    showToast(data?.error || error.message);
    return;
  }

  showToast("Rank updated.");
  await loadAll();
}

async function setStaffPassword(profileId, displayName) {
  if (!isOwner()) {
    showToast("Only Owner can reset passwords.");
    return;
  }

  const password = prompt("Enter new password for " + displayName + ":");

  if (password === null) return;

  if (!String(password).trim()) {
    showToast("Password cannot be empty.");
    return;
  }

  const { data, error } = await sb.functions.invoke("manage-staff", {
    body: {
      action: "set-password",
      target_user_id: profileId,
      password
    }
  });

  if (error || data?.error) {
    showToast(data?.error || error.message);
    return;
  }

  showToast("Password updated.");
}

async function deleteStaff(profileId, displayName) {
  if (!confirm("Kick/delete staff account " + displayName + "?")) return;

  const { data, error } = await sb.functions.invoke("manage-staff", {
    body: {
      action: "delete",
      target_user_id: profileId
    }
  });

  if (error || data?.error) {
    showToast(data?.error || error.message);
    return;
  }

  showToast("Staff account deleted.");
  await loadAll();
}

function promoteProfile(profile) {
  const rank = getRank(profile.rank);
  const next = getRankByLevel(rank.level + 1);

  if (!next) {
    showToast("Already highest rank.");
    return;
  }

  changeStaffRank(profile.id, next.key);
}

function demoteProfile(profile) {
  const rank = getRank(profile.rank);
  const previous = getRankByLevel(rank.level - 1);

  if (!previous) {
    showToast("Already lowest rank.");
    return;
  }

  changeStaffRank(profile.id, previous.key);
}

function renderStaffList() {
  const container = document.getElementById("staffList");
  const sorted = [...profiles].sort((a, b) => getRank(b.rank).level - getRank(a.rank).level);

  if (!sorted.length) {
    container.innerHTML = `<div class="item"><p>No staff accounts found.</p></div>`;
    return;
  }

  container.innerHTML = sorted.map(profile => {
    const rank = getRank(profile.rank);

    return `
      <div class="item">
        <div class="item-top">
          <div class="staff-list-title">
            <div class="staff-list-avatar">${avatarHtml(profile, "staff-avatar-img")}</div>
            <h4>${escapeHtml(profile.display_name || profile.email)}</h4>
          </div>
          <span class="badge purple">${escapeHtml(rank.name)}</span>
        </div>
        <p><strong>Email:</strong> ${escapeHtml(profile.email || "Unknown")}</p>
        <p><strong>Created:</strong> ${formatDate(profile.created_at)}</p>
      </div>
    `;
  }).join("");
}

function renderRankInfoList() {
  const container = document.getElementById("rankInfoList");

  container.innerHTML = RANKS.map((rank, index) => `
    <div class="item rank-row">
      <div class="rank-num">${index + 1}</div>
      <div>
        <div class="item-top">
          <h4>${escapeHtml(rank.name)}</h4>
          <span class="badge">Level ${rank.level}</span>
        </div>
        <p>${rankDescription(rank)}</p>
      </div>
    </div>
  `).join("");
}

function renderRankManagementList() {
  const container = document.getElementById("rankManagementList");
  const sortedRanks = [...RANKS].sort((a, b) => b.level - a.level);

  container.innerHTML = sortedRanks.map(rank => {
    const users = profiles
      .filter(profile => profile.rank === rank.key)
      .sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));

    const usersHtml = users.length
      ? users.map(profile => profileControlHtml(profile)).join("")
      : `<div class="item"><p>No accounts in this rank.</p></div>`;

    return `
      <div class="rank-group">
        <div class="rank-group-title">
          <strong>${escapeHtml(rank.name)}</strong>
          <span class="badge">Level ${rank.level}</span>
        </div>
        ${usersHtml}
      </div>
    `;
  }).join("");
}

function profileControlHtml(profile) {
  const rank = getRank(profile.rank);
  const canControl = canCurrentControl(profile);
  const canKick = canCurrentKick(profile);
  const canResetPassword = isOwner() && profile.id !== currentProfile?.id;
  const next = getRankByLevel(rank.level + 1);
  const previous = getRankByLevel(rank.level - 1);
  const promoteAllowed = canControl && next && canCurrentAssignRank(next.key);
  const demoteAllowed = canControl && previous;

  return `
    <div class="item">
      <div class="item-top">
        <h4>${escapeHtml(profile.display_name || profile.email)}</h4>
        <span class="badge purple">${escapeHtml(rank.name)}</span>
      </div>
      <p><strong>Email:</strong> ${escapeHtml(profile.email || "Unknown")}</p>
      <div class="warning-actions">
        <button class="mini-btn promote" onclick='setStaffPassword("${profile.id}", ${JSON.stringify(profile.display_name || profile.email)})' ${canResetPassword ? "" : "disabled"}>Reset Password</button>
        <button class="mini-btn promote" onclick='promoteProfile(${JSON.stringify(profile)})' ${promoteAllowed ? "" : "disabled"}>Promote</button>
        <button class="mini-btn demote" onclick='demoteProfile(${JSON.stringify(profile)})' ${demoteAllowed ? "" : "disabled"}>Demote</button>
        <button class="mini-btn remove" onclick='deleteStaff("${profile.id}", ${JSON.stringify(profile.display_name || profile.email)})' ${canKick ? "" : "disabled"}>Kick</button>
      </div>
    </div>
  `;
}

function canCurrentControl(target) {
  const currentRank = getRank(currentProfile?.rank);
  const targetRank = getRank(target.rank);

  if (!currentProfile || !currentRank.canManageRanks) return false;
  if (target.id === currentProfile.id) return false;
  if (currentRank.key === "owner") return true;

  return targetRank.level < currentRank.level;
}

function canCurrentAssignRank(rankKey) {
  const currentRank = getRank(currentProfile?.rank);
  const targetRank = getRank(rankKey);

  if (!currentProfile || !currentRank.canManageRanks) return false;
  if (currentRank.key === "owner") return true;

  return targetRank.level < currentRank.level;
}

function canCurrentKick(target) {
  const currentRank = getRank(currentProfile?.rank);
  const targetRank = getRank(target.rank);

  if (!currentProfile || !currentRank.canKick) return false;
  if (target.id === currentProfile.id) return false;
  if (currentRank.key === "owner") return true;

  return targetRank.level < currentRank.level;
}

function getRank(key) {
  return RANKS.find(rank => rank.key === key) || RANKS[0];
}

function getRankByLevel(level) {
  return RANKS.find(rank => rank.level === level) || null;
}

function isOwner() {
  return currentProfile?.rank === "owner";
}

function canSeeRemovedWarnings() {
  return getRank(currentProfile?.rank).level >= 3;
}

function rankDescription(rank) {
  if (rank.key === "staff") return "Can give warnings only.";
  if (rank.key === "admin") return "Can give and remove warnings.";
  if (rank.key === "manager") return "Can give/remove warnings, manage Staff/Admin, and kick lower ranks.";
  if (rank.key === "management") return "Can manage Manager and below, and kick lower ranks.";
  if (rank.key === "owner") return "Full access to warnings, account creation, rank management, password resets, and account deletion.";
  return "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDate(value) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}
