import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, query as firestoreQuery, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebase/firebaseConfig";
import ImageCropModal from "../components/ImageCropModal";
import { useToast } from "../components/ToastContext.jsx";
import "../styles/Settings.css";

const YEAR_SECTION_LOCK_DAYS = 365;
const MOBILE_NUMBER_LOCK_DAYS = 30;

function Settings() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const outletContext = useOutletContext() || {};
  const { setUnsavedChanges, guardedNavigate, schoolStatus } = outletContext;

  const [currentUser, setCurrentUser] = useState(null);
  const [userRecord, setUserRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  const [fullName, setFullName] = useState("");
  const [userType, setUserType] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [courseDepartment, setCourseDepartment] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [section, setSection] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");
  const [croppedPhotoBlob, setCroppedPhotoBlob] = useState(null);
  const [croppedPhotoSize, setCroppedPhotoSize] = useState(0);
  const [cropSourceFile, setCropSourceFile] = useState(null);

  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [profileFieldErrors, setProfileFieldErrors] = useState({});
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({});

  const [profileTouched, setProfileTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmProfileSaveOpen, setConfirmProfileSaveOpen] = useState(false);
  const [pendingProfileChanges, setPendingProfileChanges] = useState([]);
  const [schoolClosureReason, setSchoolClosureReason] = useState("");
  const [savingSchoolStatus, setSavingSchoolStatus] = useState(false);
  const [systemSuspensionReason, setSystemSuspensionReason] = useState("");
const [savingSystemSuspension, setSavingSystemSuspension] = useState(false);
  const [penaltyRecords, setPenaltyRecords] = useState([]);

function clearInlineStatus() {
  // Inline Settings banners were replaced by toast notifications.
}

function showStatus(message, type) {
  clearInlineStatus();

  const cleanedMessage = String(message || "").trim();

  if (!cleanedMessage) return;

  showToast(cleanedMessage, type === "error" ? "error" : "success");
}

function showActionError(shortMessage, error) {
  console.error(shortMessage, error);

  clearInlineStatus();
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  clearInlineStatus();
  showToast(message, "error");
}

  function isSuperAdminProfile() {
    return userRecord?.role === "superAdmin";
  }

  function isSchoolClosed() {
    return Boolean(schoolStatus?.isSchoolClosed);
  }

  function isSystemSuspended() {
  return Boolean(schoolStatus?.isSystemSuspended);
}

  function formatSchoolTimestamp(value) {
    const date = getDateFromValue(value);

    if (!date) return "Not recorded";

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatClosureDateKey(dateValue) {
    const date = dateValue instanceof Date ? dateValue : getDateFromValue(dateValue);

    if (!date) return "";

    const safeDate = new Date(date);
    safeDate.setHours(0, 0, 0, 0);

    const timezoneOffset = safeDate.getTimezoneOffset() * 60000;

    return new Date(safeDate.getTime() - timezoneOffset)
      .toISOString()
      .split("T")[0];
  }

  function parseClosureDateKey(dateKey) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);

    if (!year || !month || !day) return null;

    return new Date(year, month - 1, day);
  }

  function addDaysToDateKey(dateKey, daysToAdd) {
    const baseDate = parseClosureDateKey(dateKey);

    if (!baseDate) return dateKey;

    baseDate.setDate(baseDate.getDate() + daysToAdd);

    return formatClosureDateKey(baseDate);
  }

  function getClosureDayCount(closedAtValue, reopenedAtDate = new Date()) {
    const closedAtDate = getDateFromValue(closedAtValue);

    if (!closedAtDate) return 0;

    const closureStartDate = new Date(closedAtDate);
    closureStartDate.setHours(0, 0, 0, 0);

    const reopenStartDate = new Date(reopenedAtDate);
    reopenStartDate.setHours(0, 0, 0, 0);

    const oneDayMs = 24 * 60 * 60 * 1000;
    const dayCount = Math.round(
      (reopenStartDate.getTime() - closureStartDate.getTime()) / oneDayMs
    );

    return Math.max(dayCount, 0);
  }

async function handleUpdateSchoolStatus(nextClosed) {
  if (!currentUser) {
    showBlockedAction("No logged-in user found.");
    return;
  }

  if (!isSuperAdminProfile()) {
    showBlockedAction("Only super admins can change school availability.");
    return;
  }

const DEFAULT_SCHOOL_CLOSURE_REASON =
  "School is closed today. Please come back tomorrow.";

const cleanedReason =
  String(schoolClosureReason || "").trim() || DEFAULT_SCHOOL_CLOSURE_REASON;

  setSavingSchoolStatus(true);
  showStatus("", "");

  try {
    const schoolStatusRef = doc(db, "systemSettings", "schoolStatus");

    const basePayload = {
      isSchoolClosed: nextClosed,
      updatedAt: serverTimestamp(),
    };

    const statusPayload = nextClosed
      ? {
          ...basePayload,
          closureReason: cleanedReason,
          closedAt: serverTimestamp(),
          closedBy: currentUser.uid,
          closedByName:
            userRecord?.fullName || currentUser.email || "Super Admin",
        }
      : {
          ...basePayload,
          closureReason: "",
          reopenedAt: serverTimestamp(),
          reopenedBy: currentUser.uid,
        };

    await setDoc(schoolStatusRef, statusPayload, { merge: true });

    if (!nextClosed) {
      setSchoolClosureReason("");
    }

    const message = nextClosed
      ? "School Closed Today is now active. Borrowing, item release, and return confirmation are unavailable, but timers will continue running."
      : "School Closed Today is now inactive. Borrowing, item release, and return confirmation are available again.";

    showStatus(message, "success");
    showToast(nextClosed ? "School closed today" : "School reopened", "success");
  } catch (error) {
    showActionError("Failed to update school status", error);
  } finally {
    setSavingSchoolStatus(false);
  }
}

async function extendBorrowedDueDatesForSystemSuspension() {
  const suspendedAtDate = getDateFromValue(schoolStatus?.systemSuspendedAt);
  const suspensionDays = getClosureDayCount(schoolStatus?.systemSuspendedAt);

  if (!suspendedAtDate || suspensionDays <= 0) {
    return {
      suspensionDays: 0,
      extendedCount: 0,
    };
  }

  const suspensionStartDateKey = formatClosureDateKey(suspendedAtDate);
  const borrowRequestsSnapshot = await getDocs(collection(db, "borrowRequests"));

  const borrowedRequestsToExtend = borrowRequestsSnapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((request) => {
      if (request.approvalStatus !== "Borrowed") return false;
      if (!request.expectedReturnDate) return false;

      return String(request.expectedReturnDate) >= suspensionStartDateKey;
    });

  await Promise.allSettled(
    borrowedRequestsToExtend.map(async (request) => {
      const previousExtendedDays = Number(request.systemSuspensionExtendedDays || 0);
      const newExpectedReturnDate = addDaysToDateKey(
        request.expectedReturnDate,
        suspensionDays
      );

      await updateDoc(doc(db, "borrowRequests", request.id), {
        expectedReturnDate: newExpectedReturnDate,
        originalExpectedReturnDate:
          request.originalExpectedReturnDate || request.expectedReturnDate,
        systemSuspensionExtended: true,
        systemSuspensionExtendedDays: previousExtendedDays + suspensionDays,
        lastSystemSuspensionExtendedDays: suspensionDays,
        systemSuspensionAdjustedAt: serverTimestamp(),
        systemSuspensionAdjustedBy: currentUser.uid,
        systemSuspensionAdjustmentReason: `Return date extended by ${suspensionDays} day${
          suspensionDays === 1 ? "" : "s"
        } because of system suspension.`,
        updatedAt: serverTimestamp(),
      });
    })
  );

  return {
    suspensionDays,
    extendedCount: borrowedRequestsToExtend.length,
  };
}

async function handleUpdateSystemSuspensionStatus(nextSuspended) {
  if (!currentUser) {
    showBlockedAction("No logged-in user found.");
    return;
  }

  if (!isSuperAdminProfile()) {
    showBlockedAction("Only super admins can suspend or resume the system.");
    return;
  }

  const cleanedReason = String(systemSuspensionReason || "").trim();

  if (nextSuspended && !cleanedReason) {
    showBlockedAction("Please enter a reason before suspending the system.");
    return;
  }

  setSavingSystemSuspension(true);
  showStatus("", "");

  try {
    const schoolStatusRef = doc(db, "systemSettings", "schoolStatus");

    let suspensionExtensionResult = {
      suspensionDays: 0,
      extendedCount: 0,
    };

    if (!nextSuspended && isSystemSuspended()) {
      suspensionExtensionResult = await extendBorrowedDueDatesForSystemSuspension();
    }

    const basePayload = {
      isSystemSuspended: nextSuspended,
      updatedAt: serverTimestamp(),
    };

    const statusPayload = nextSuspended
      ? {
          ...basePayload,
          systemSuspensionReason: cleanedReason,
          systemSuspendedAt: serverTimestamp(),
          systemSuspendedBy: currentUser.uid,
          systemSuspendedByName:
            userRecord?.fullName || currentUser.email || "Super Admin",
        }
      : {
          ...basePayload,
          systemSuspensionReason: "",
          systemResumedAt: serverTimestamp(),
          systemResumedBy: currentUser.uid,
          lastSystemSuspensionExtendedDays:
            suspensionExtensionResult.suspensionDays,
          lastSystemSuspensionExtendedRequests:
            suspensionExtensionResult.extendedCount,
          lastSystemSuspensionAdjustedAt: serverTimestamp(),
        };

    await setDoc(schoolStatusRef, statusPayload, { merge: true });

    if (!nextSuspended) {
      setSystemSuspensionReason("");
    }

    const resumeDetail =
      !nextSuspended && suspensionExtensionResult.suspensionDays > 0
        ? ` ${suspensionExtensionResult.extendedCount} borrowed request${
            suspensionExtensionResult.extendedCount === 1 ? "" : "s"
          } were extended by ${suspensionExtensionResult.suspensionDays} suspension day${
            suspensionExtensionResult.suspensionDays === 1 ? "" : "s"
          }.`
        : "";

    const message = nextSuspended
      ? "System Suspension Mode is now active. All borrowing workflows and timers are paused."
      : `System Suspension Mode is now inactive. Workflows and timers are resumed.${resumeDetail}`;

    showStatus(message, "success");
    showToast(nextSuspended ? "System suspended" : "System resumed", "success");
  } catch (error) {
    showActionError("Failed to update system suspension", error);
  } finally {
    setSavingSystemSuspension(false);
  }
}

  function markProfileChanged() {
    setProfileTouched(true);
  }

  function markPasswordChanged() {
    setPasswordTouched(true);
  }

  function clearProfileFieldError(fieldName) {
    setProfileFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function clearPasswordFieldError(fieldName) {
    setPasswordFieldErrors((previousErrors) => ({
      ...previousErrors,
      [fieldName]: "",
    }));
  }

  function isValidPersonName(value) {
    const cleanedValue = String(value || "").trim();

    if (cleanedValue.length < 2) return false;
    if (cleanedValue.length > 80) return false;

    return /^[\p{L}][\p{L}\s.'-]*[\p{L}.]$/u.test(cleanedValue);
  }

  function getPersonNameError(value) {
    const cleanedValue = String(value || "").trim();

    if (!cleanedValue) {
      return "Display name is required.";
    }

    if (cleanedValue.length < 2) {
      return "Display name must be at least 2 characters.";
    }

    if (cleanedValue.length > 80) {
      return "Display name must not exceed 80 characters.";
    }

    if (!isValidPersonName(cleanedValue)) {
      return "Display name can only contain letters, spaces, dot, hyphen, and apostrophe.";
    }

    return "";
  }

  function sanitizePersonNameInput(value) {
    return String(value || "").replace(/[^\p{L}\s.'-]/gu, "");
  }

  function validateProfileField(fieldName) {
    setProfileFieldErrors((previousErrors) => {
      const nextErrors = { ...previousErrors };

      if (fieldName === "fullName") {
        const fullNameError = getPersonNameError(fullName);

        if (fullNameError) {
          nextErrors.fullName = fullNameError;
        } else {
          delete nextErrors.fullName;
        }
      }

      if (fieldName === "mobileNumber") {
        const mobileNumberError = getMobileNumberError(mobileNumber);

        if (mobileNumberError) {
          nextErrors.mobileNumber = mobileNumberError;
        } else {
          delete nextErrors.mobileNumber;
        }
      }

      return nextErrors;
    });
  }

  function validatePasswordField(fieldName) {
    setPasswordFieldErrors((previousErrors) => {
      const nextErrors = { ...previousErrors };

      if (fieldName === "passwordCurrent") {
        if (!passwordCurrent) {
          nextErrors.passwordCurrent = "Current password is required.";
        } else {
          delete nextErrors.passwordCurrent;
        }
      }

      if (fieldName === "newPassword") {
        if (!newPassword) {
          nextErrors.newPassword = "New password is required.";
        } else if (newPassword.length < 6) {
          nextErrors.newPassword = "New password must be at least 6 characters.";
        } else {
          delete nextErrors.newPassword;
        }

        if (confirmNewPassword && newPassword !== confirmNewPassword) {
          nextErrors.confirmNewPassword = "New passwords do not match.";
        } else if (confirmNewPassword) {
          delete nextErrors.confirmNewPassword;
        }
      }

      if (fieldName === "confirmNewPassword") {
        if (!confirmNewPassword) {
          nextErrors.confirmNewPassword = "Please confirm your new password.";
        } else if (newPassword !== confirmNewPassword) {
          nextErrors.confirmNewPassword = "New passwords do not match.";
        } else {
          delete nextErrors.confirmNewPassword;
        }
      }

      return nextErrors;
    });
  }

  function validateProfileForm() {
    const errors = {};
    const fullNameError = getPersonNameError(fullName);

    if (fullNameError) {
      errors.fullName = fullNameError;
    }

    if (isBorrowerProfile()) {
      const yearSectionLockInfo = getYearSectionLockInfo();
      const mobileNumberLockInfo = getMobileNumberLockInfo();
      const mobileNumberError = getMobileNumberError(mobileNumber);

      if (didYearSectionChange() && yearSectionLockInfo.locked) {
        const lockMessage = `Year level and section can only be changed once per year. Next change available on ${yearSectionLockInfo.nextDate}. Please contact the admin if this needs correction.`;
        errors.yearLevel = lockMessage;
        errors.section = lockMessage;
      }

      if (mobileNumberError) {
        errors.mobileNumber = mobileNumberError;
      } else if (didMobileNumberChange() && mobileNumberLockInfo.locked) {
        errors.mobileNumber = `Mobile number can only be changed once per month. Next change available on ${mobileNumberLockInfo.nextDate}. Please contact the admin if this needs correction.`;
      }
    }

    setProfileFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function validatePasswordForm() {
    const errors = {};

    if (!passwordCurrent) {
      errors.passwordCurrent = "Current password is required.";
    }

    if (!newPassword) {
      errors.newPassword = "New password is required.";
    } else if (newPassword.length < 6) {
      errors.newPassword = "New password must be at least 6 characters.";
    }

    if (!confirmNewPassword) {
      errors.confirmNewPassword = "Please confirm your new password.";
    } else if (newPassword !== confirmNewPassword) {
      errors.confirmNewPassword = "New passwords do not match.";
    }

    setPasswordFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function getRoleLabel(role) {
    if (role === "superAdmin") return "Super Admin";
    if (role === "categoryAdmin") return "Category Admin";
    return "Borrower";
  }

  function normalizeDetailValue(value) {
    return String(value || "").trim();
  }

  function getBorrowerUserType(record) {
    return normalizeDetailValue(record?.userType || record?.borrowerUserType);
  }

  function getBorrowerStudentNumber(record) {
    return normalizeDetailValue(
      record?.studentNumber || record?.borrowerStudentNumber || record?.employeeId
    );
  }

  function getBorrowerCourseDepartment(record) {
    return normalizeDetailValue(
      record?.courseDepartment ||
        record?.course ||
        record?.department ||
        record?.borrowerCourseDepartment
    );
  }

  function getBorrowerYearLevel(record) {
    return normalizeDetailValue(record?.yearLevel || record?.borrowerYearLevel);
  }

  function getBorrowerSection(record) {
    return normalizeDetailValue(record?.section || record?.borrowerSection);
  }

  function getBorrowerMobileNumber(record) {
    return normalizeDetailValue(record?.mobileNumber || record?.borrowerMobileNumber);
  }

  function sanitizeMobileNumberInput(value) {
    return String(value || "").replace(/[^0-9+\s()-]/g, "");
  }

  function cleanMobileNumberForSave(value) {
    return String(value || "").replace(/[\s()-]/g, "").trim();
  }

  function isValidMobileNumber(value) {
    const cleanedValue = cleanMobileNumberForSave(value);

    if (!cleanedValue) return true;

    return /^\+?\d{10,15}$/.test(cleanedValue);
  }

  function getMobileNumberError(value) {
    if (!isValidMobileNumber(value)) {
      return "Mobile number must contain 10 to 15 digits. You may include + for country code.";
    }

    return "";
  }

  function addDaysToDate(date, numberOfDays) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + numberOfDays);
    return nextDate;
  }

  function formatProfileLockDate(value) {
    const date = getDateFromValue(value);

    if (!date) return "";

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function getProfileLockInfo(lastUpdatedValue, lockDays) {
    const lastUpdatedDate = getDateFromValue(lastUpdatedValue);

    if (!lastUpdatedDate) {
      return {
        locked: false,
        nextDate: "",
      };
    }

    const nextAllowedDate = addDaysToDate(lastUpdatedDate, lockDays);
    const isLocked = nextAllowedDate > new Date();

    return {
      locked: isLocked,
      nextDate: formatProfileLockDate(nextAllowedDate),
    };
  }

  function isBorrowerProfile() {
    return userRecord?.role === "borrower";
  }

  function getYearSectionLockInfo() {
    return getProfileLockInfo(
      userRecord?.profileYearSectionUpdatedAt || userRecord?.yearSectionUpdatedAt,
      YEAR_SECTION_LOCK_DAYS
    );
  }

  function getMobileNumberLockInfo() {
    return getProfileLockInfo(
      userRecord?.profileMobileUpdatedAt || userRecord?.mobileNumberUpdatedAt,
      MOBILE_NUMBER_LOCK_DAYS
    );
  }

  function didYearSectionChange() {
    return (
      normalizeDetailValue(yearLevel) !== getBorrowerYearLevel(userRecord) ||
      normalizeDetailValue(section) !== getBorrowerSection(userRecord)
    );
  }

  function didMobileNumberChange() {
    return (
      cleanMobileNumberForSave(mobileNumber) !==
      cleanMobileNumberForSave(getBorrowerMobileNumber(userRecord))
    );
  }

  function getDisplayValue(value) {
    const cleanedValue = normalizeDetailValue(value);

    return cleanedValue || "Not set";
  }

  function buildProfileChangeSummary(cleanedFullName = fullName.trim()) {
    const changes = [];

    if (cleanedFullName !== normalizeDetailValue(userRecord?.fullName)) {
      changes.push({
        field: "Display Name",
        from: getDisplayValue(userRecord?.fullName),
        to: getDisplayValue(cleanedFullName),
      });
    }

    if (croppedPhotoBlob) {
      changes.push({
        field: "Profile Picture",
        from: userRecord?.photoURL ? "Current photo" : "No photo",
        to: "New cropped photo",
      });
    }

    if (isBorrowerProfile()) {
      if (normalizeDetailValue(yearLevel) !== getBorrowerYearLevel(userRecord)) {
        changes.push({
          field: "Year Level",
          from: getDisplayValue(getBorrowerYearLevel(userRecord)),
          to: getDisplayValue(yearLevel),
          lockNote: "After saving, borrower self-change locks for 1 year.",
        });
      }

      if (normalizeDetailValue(section) !== getBorrowerSection(userRecord)) {
        changes.push({
          field: "Section",
          from: getDisplayValue(getBorrowerSection(userRecord)),
          to: getDisplayValue(section),
          lockNote: "After saving, borrower self-change locks for 1 year.",
        });
      }

      if (didMobileNumberChange()) {
        changes.push({
          field: "Mobile Number",
          from: getDisplayValue(getBorrowerMobileNumber(userRecord)),
          to: getDisplayValue(cleanMobileNumberForSave(mobileNumber)),
          lockNote: "After saving, borrower self-change locks for 1 month.",
        });
      }
    }

    return changes;
  }

  function closeProfileSaveConfirmation() {
    if (savingProfile) return;

    setConfirmProfileSaveOpen(false);
    setPendingProfileChanges([]);
  }

  function getDateFromValue(value) {
    if (!value) return null;

    if (typeof value?.toDate === "function") {
      return value.toDate();
    }

    if (value?.seconds) {
      return new Date(value.seconds * 1000);
    }

    const parsedDate = new Date(value);

    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  function formatBorrowingDateTime(value) {
    const date = getDateFromValue(value);

    if (!date) return "No active restriction";

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatPenaltyDateTime(value) {
    const date = getDateFromValue(value);

    if (!date) return "Not recorded";

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getSortedPenaltyRecords() {
    return [...penaltyRecords].sort((a, b) => {
      const firstDate = getDateFromValue(a.createdAt)?.getTime() || 0;
      const secondDate = getDateFromValue(b.createdAt)?.getTime() || 0;

      return secondDate - firstDate;
    });
  }

  function getPenaltyStatusLabel(record) {
    if (record?.status === "Resolved") return "Resolved";

    const restrictionEndDate = getDateFromValue(record?.restrictionEndAt);

    if (restrictionEndDate && restrictionEndDate < new Date()) {
      return "Completed";
    }

    return record?.status || "Active";
  }

  function getPenaltyStatusClass(record) {
    return String(getPenaltyStatusLabel(record) || "active")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function fetchPenaltyRecords(userId) {
    if (!userId) {
      setPenaltyRecords([]);
      return;
    }

    const penaltyQuery = firestoreQuery(
      collection(db, "penaltyRecords"),
      where("borrowerId", "==", userId)
    );

    const penaltySnapshot = await getDocs(penaltyQuery);

    setPenaltyRecords(
      penaltySnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))
    );
  }

  function getBorrowingStatusInfo() {
    if (userRecord?.role !== "borrower") {
      return null;
    }

    const suspendedUntilDate = getDateFromValue(userRecord?.suspendedUntil);
    const hasFutureRestriction =
      suspendedUntilDate && suspendedUntilDate > new Date();
    const reason = String(userRecord?.suspensionReason || "").trim();
    const normalizedReason = reason.toLowerCase();

    if (userRecord?.canBorrow === false || hasFutureRestriction) {
      const isTemporaryRestriction =
        normalizedReason.includes("temporary borrowing restriction") ||
        normalizedReason.includes("approved item") ||
        normalizedReason.includes("claimed/released");

      return {
        label: isTemporaryRestriction
          ? "Temporarily Restricted"
          : "Suspended",
        tone: isTemporaryRestriction ? "warning" : "danger",
        canBorrow: "No",
        until: formatBorrowingDateTime(userRecord?.suspendedUntil),
        reason:
          reason ||
          "Your borrowing access is currently restricted. Please contact the admin for assistance.",
        detail: isTemporaryRestriction
          ? "This is a short restriction. Admins can restore access early if this was caused by a release encoding mistake."
          : "Borrowing access is restricted until the admin restores your account or the suspension period ends.",
      };
    }

    return {
      label: "Good Standing",
      tone: "success",
      canBorrow: "Yes",
      until: "No active restriction",
      reason: "No active borrowing restriction.",
      detail: "You can submit borrow requests as long as items are available.",
    };
  }

  function getInitials(name, email) {
    const source = name || email || "User";

    const initials = source
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    return initials || "U";
  }

  function revokePreview(url) {
    if (url && url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }

  async function loadUserRecord(user) {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = {
        id: userSnap.id,
        uid: user.uid,
        email: user.email,
        ...userSnap.data(),
      };

      setUserRecord(data);
      setFullName(data.fullName || "");
      setUserType(getBorrowerUserType(data));
      setStudentNumber(getBorrowerStudentNumber(data));
      setCourseDepartment(getBorrowerCourseDepartment(data));
      setYearLevel(getBorrowerYearLevel(data));
      setSection(getBorrowerSection(data));
      setMobileNumber(getBorrowerMobileNumber(data));

      if (data.photoURL) {
        setPhotoPreview(data.photoURL);
      }
    }
  }

  async function reauthenticateUser(password) {
    if (!currentUser?.email) {
      throw new Error("No logged-in user found.");
    }

    const credential = EmailAuthProvider.credential(currentUser.email, password);
    await reauthenticateWithCredential(currentUser, credential);
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    showStatus("", "");
    clearProfileFieldError("profilePhoto");

    if (!file.type.startsWith("image/")) {
      setProfileFieldErrors((previousErrors) => ({
        ...previousErrors,
        profilePhoto: "Please upload an image file only.",
      }));
      showBlockedAction("Please upload an image file only.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setProfileFieldErrors((previousErrors) => ({
        ...previousErrors,
        profilePhoto: "Image is too large. Please upload an image below 5MB.",
      }));
      showBlockedAction("Image is too large. Please upload an image below 5MB.");
      return;
    }

    setCropSourceFile(file);
  }

  function handleProfileCropComplete(blob, previewUrl) {
    revokePreview(photoPreview);

    setCroppedPhotoBlob(blob);
    setCroppedPhotoSize(blob.size);
    setPhotoPreview(previewUrl);
    setCropSourceFile(null);
    setProfileTouched(true);

    showStatus(
      `Profile picture cropped and compressed to ${(blob.size / 1024).toFixed(
        1
      )} KB. Click Save Settings to apply the update.`,
      "success"
    );
  }

  async function handleSaveProfile(event, options = {}) {
    event?.preventDefault?.();

    if (!currentUser) {
      showBlockedAction("No logged-in user found.");
      return;
    }

    showStatus("", "");

    const isValid = validateProfileForm();

    if (!isValid) {
      return;
    }

    const cleanedFullName = fullName.trim();
    const profileChanges = buildProfileChangeSummary(cleanedFullName);

    if (!options.confirmed) {
      if (profileChanges.length === 0) {
        showStatus("No profile changes to save.", "success");
        showToast("No changes to save", "success");
        return;
      }

      setPendingProfileChanges(profileChanges);
      setConfirmProfileSaveOpen(true);
      return;
    }

    setConfirmProfileSaveOpen(false);
    setPendingProfileChanges(profileChanges);
    setSavingProfile(true);

    try {
      let uploadedPhotoURL = userRecord?.photoURL || "";
      let uploadedPhotoPath = userRecord?.photoPath || "";

      if (croppedPhotoBlob) {
        uploadedPhotoPath = `profilePictures/${currentUser.uid}/avatar.jpg`;
        const photoRef = ref(storage, uploadedPhotoPath);

        await uploadBytes(photoRef, croppedPhotoBlob, {
          contentType: "image/jpeg",
          cacheControl: "public,max-age=3600",
        });

        uploadedPhotoURL = await getDownloadURL(photoRef);
      }

      const userRef = doc(db, "users", currentUser.uid);
      const profileUpdatePayload = {
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
        updatedAt: serverTimestamp(),
      };

      const localUpdatedUserData = {
        ...userRecord,
        fullName: cleanedFullName,
        photoURL: uploadedPhotoURL,
        photoPath: uploadedPhotoPath,
      };

      if (isBorrowerProfile()) {
        const cleanedYearLevel = normalizeDetailValue(yearLevel);
        const cleanedSection = normalizeDetailValue(section);
        const cleanedMobileNumber = cleanMobileNumberForSave(mobileNumber);
        const now = new Date();

        if (didYearSectionChange()) {
          profileUpdatePayload.yearLevel = cleanedYearLevel;
          profileUpdatePayload.section = cleanedSection;
          profileUpdatePayload.profileYearSectionUpdatedAt = serverTimestamp();

          localUpdatedUserData.yearLevel = cleanedYearLevel;
          localUpdatedUserData.section = cleanedSection;
          localUpdatedUserData.profileYearSectionUpdatedAt = now;
        }

        if (didMobileNumberChange()) {
          profileUpdatePayload.mobileNumber = cleanedMobileNumber;
          profileUpdatePayload.profileMobileUpdatedAt = serverTimestamp();

          localUpdatedUserData.mobileNumber = cleanedMobileNumber;
          localUpdatedUserData.profileMobileUpdatedAt = now;
        }
      }

      await updateDoc(userRef, profileUpdatePayload);

      const updatedUserData = localUpdatedUserData;

      setUserRecord(updatedUserData);
      setFullName(cleanedFullName);
      setYearLevel(getBorrowerYearLevel(updatedUserData));
      setSection(getBorrowerSection(updatedUserData));
      setMobileNumber(getBorrowerMobileNumber(updatedUserData));
      setCroppedPhotoBlob(null);
      setCroppedPhotoSize(0);
      setProfileFieldErrors({});
      setProfileTouched(false);
      setPendingProfileChanges([]);
      setConfirmProfileSaveOpen(false);

      window.dispatchEvent(
        new CustomEvent("qborrow-user-updated", {
          detail: {
            fullName: cleanedFullName,
            photoURL: uploadedPhotoURL,
            photoPath: uploadedPhotoPath,
            yearLevel: updatedUserData.yearLevel,
            section: updatedUserData.section,
            mobileNumber: updatedUserData.mobileNumber,
          },
        })
      );

      showToast("Settings Saved", "success");
    } catch (error) {
      showActionError("Failed to save settings", error);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(event) {
    event.preventDefault();

    if (!currentUser) {
      showStatus("No logged-in user found.", "error");
      return;
    }

    showStatus("", "");

    const isValid = validatePasswordForm();

    if (!isValid) {
      return;
    }

    setChangingPassword(true);

    try {
      await reauthenticateUser(passwordCurrent);
      await updatePassword(currentUser, newPassword);

      setPasswordCurrent("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordFieldErrors({});
      setPasswordTouched(false);

      showToast("Password Changed", "success");
    } catch (error) {
      showActionError("Failed to change password", error);
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        showBlockedAction("Please login first.");
        setLoading(false);
        return;
      }

      setCurrentUser(user);

      try {
        await loadUserRecord(user);
        await fetchPenaltyRecords(user.uid);
      } catch (error) {
        showActionError("Failed to load settings", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setUnsavedChanges?.(
      (profileTouched || passwordTouched) && !savingProfile && !changingPassword,
      "You have unsaved settings changes. Leaving this page will discard your progress."
    );

    return () => {
      setUnsavedChanges?.(false);
    };
  }, [
    profileTouched,
    passwordTouched,
    savingProfile,
    changingPassword,
    setUnsavedChanges,
  ]);

  useEffect(() => {
    setSchoolClosureReason(String(schoolStatus?.closureReason || ""));
  }, [schoolStatus?.closureReason]);

  const borrowingStatusInfo = getBorrowingStatusInfo();
  const yearSectionLockInfo = getYearSectionLockInfo();
  const mobileNumberLockInfo = getMobileNumberLockInfo();

  if (loading) {
    return (
      <div className="settings-loading">
        <div className="settings-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading settings...</h2>
          <p>Preparing your account settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          title="Crop Profile Picture"
          outputSize={320}
          maxOutputBytes={190 * 1024}
          onCancel={() => setCropSourceFile(null)}
          onCropComplete={handleProfileCropComplete}
        />
      )}

      {confirmProfileSaveOpen &&
        createPortal(
          <div
            className="settings-confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeProfileSaveConfirmation();
            }
          }}
        >
          <section
            className="settings-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-confirm-title"
          >
            <div className="settings-confirm-icon">!</div>

            <div className="settings-confirm-heading">
              <h2 id="settings-confirm-title">Confirm Profile Changes</h2>
              <p>
                Are you sure you want to save these changes? Some borrower
                details will be locked after saving.
              </p>
            </div>

            <div className="settings-confirm-changes">
              {pendingProfileChanges.map((change) => (
                <article className="settings-confirm-change" key={change.field}>
                  <div>
                    <span>{change.field}</span>
                    {change.lockNote && <small>{change.lockNote}</small>}
                  </div>

                  <div className="settings-confirm-change-values">
                    <p>
                      <span>From</span>
                      <strong>{change.from}</strong>
                    </p>
                    <p>
                      <span>To</span>
                      <strong>{change.to}</strong>
                    </p>
                  </div>
                </article>
              ))}
            </div>

            <div className="settings-confirm-actions">
              <button
                type="button"
                className="settings-secondary-btn"
                onClick={closeProfileSaveConfirmation}
                disabled={savingProfile}
              >
                Cancel
              </button>

              <button
                type="button"
                className="settings-primary-btn"
                onClick={() => handleSaveProfile(null, { confirmed: true })}
                disabled={savingProfile}
              >
                {savingProfile ? "Saving..." : "Confirm Save"}
              </button>
            </div>
          </section>
        </div>,
          document.body
        )}

      <section className="settings-header settings-header-compact">
        <div className="settings-header-content">
          <div className="settings-header-text">
            <h1>Settings</h1>
            <p>
              Manage your display name, profile picture, and password. Your email
              is kept fixed for account safety.
            </p>
          </div>

          <button
            type="button"
            className="settings-secondary-btn settings-header-back-btn"
            onClick={() => {
              if (guardedNavigate) {
                guardedNavigate("/dashboard");
                return;
              }

              navigate("/dashboard");
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </section>

{/* Settings success/error messages now appear as toast notifications. */}

      <section className="settings-layout">
        <form
          className="settings-card settings-profile-card"
          onSubmit={handleSaveProfile}
          noValidate
        >
          <div className="settings-section-heading">
            <h2>Profile</h2>
            <p>Crop your picture, update your display name, and manage allowed borrower details.</p>
          </div>

          <div className="settings-profile-preview">
            <div className="settings-avatar">
              {photoPreview ? (
                <img src={photoPreview} alt="Profile preview" />
              ) : (
                <span>
                  {getInitials(fullName || userRecord?.fullName, currentUser?.email)}
                </span>
              )}
            </div>

            <div>
              <h3>{fullName || userRecord?.fullName || "Unnamed User"}</h3>
              <p>{getRoleLabel(userRecord?.role)}</p>
              <span>{currentUser?.email}</span>
            </div>
          </div>

          <div className="settings-profile-fields-grid">
            <div className="settings-field">
              <label className="qb-label" htmlFor="full-name">
                Display Name <span className="required-star">*</span>
              </label>

              <input
                id="full-name"
                type="text"
                className={profileFieldErrors.fullName ? "input-error" : ""}
                placeholder="Enter your display name"
                value={fullName}
                onFocus={() => clearProfileFieldError("fullName")}
                onBlur={() => validateProfileField("fullName")}
                onChange={(event) => {
                  const sanitizedName = sanitizePersonNameInput(event.target.value);

                  markProfileChanged();
                  setFullName(sanitizedName);
                  clearProfileFieldError("fullName");

                  if (sanitizedName !== event.target.value) {
                    setProfileFieldErrors((previousErrors) => ({
                      ...previousErrors,
                      fullName:
                        "Display name can only contain letters, spaces, dot, hyphen, and apostrophe.",
                    }));
                  }
                }}
                disabled={savingProfile}
              />

              {profileFieldErrors.fullName && (
                <p className="field-error-message">{profileFieldErrors.fullName}</p>
              )}
            </div>

            <div className="settings-field">
              <label className="qb-label" htmlFor="email">
                Email
              </label>

              <input id="email" type="email" value={currentUser?.email || ""} readOnly />
              <small>Email cannot be changed.</small>
            </div>

            <div className="settings-field">
              <label className="qb-label" htmlFor="profile-photo">
                Profile Picture
              </label>

              <input
                id="profile-photo"
                type="file"
                className={profileFieldErrors.profilePhoto ? "input-error" : ""}
                accept="image/*"
                onFocus={() => clearProfileFieldError("profilePhoto")}
                onChange={handlePhotoChange}
                disabled={savingProfile}
              />

              {profileFieldErrors.profilePhoto && (
                <p className="field-error-message">{profileFieldErrors.profilePhoto}</p>
              )}

              {croppedPhotoSize > 0 && (
                <small>
                  Compressed size: {(croppedPhotoSize / 1024).toFixed(1)} KB
                </small>
              )}
            </div>

          </div>

          {isBorrowerProfile() && (
            <section className="settings-borrower-details-card">
              <div className="settings-borrower-details-heading">
                <h3>Borrower Details</h3>
                <p>
                  User type, student number, and course/department are fixed by
                  the admin. You may update section, year level, and mobile
                  number only within the allowed schedule.
                </p>
              </div>

              <div className="settings-borrower-details-grid">
                <div className="settings-field">
                  <label className="qb-label" htmlFor="user-type">
                    User Type
                  </label>
                  <input
                    id="user-type"
                    type="text"
                    value={userType || "Not set"}
                    readOnly
                  />
                  <small>Only admins can change this field.</small>
                </div>

                <div className="settings-field">
                  <label className="qb-label" htmlFor="student-number">
                    Student Number
                  </label>
                  <input
                    id="student-number"
                    type="text"
                    value={studentNumber || "Not set"}
                    readOnly
                  />
                  <small>Only admins can change this field.</small>
                </div>

                <div className="settings-field">
                  <label className="qb-label" htmlFor="course-department">
                    Course / Department
                  </label>
                  <input
                    id="course-department"
                    type="text"
                    value={courseDepartment || "Not set"}
                    readOnly
                  />
                  <small>Only admins can change this field.</small>
                </div>

                <div className="settings-field">
                  <label className="qb-label" htmlFor="year-level">
                    Year Level
                  </label>
                  <select
                    id="year-level"
                    className={profileFieldErrors.yearLevel ? "input-error" : ""}
                    value={yearLevel}
                    onFocus={() => clearProfileFieldError("yearLevel")}
                    onChange={(event) => {
                      markProfileChanged();
                      setYearLevel(event.target.value);
                      clearProfileFieldError("yearLevel");
                      clearProfileFieldError("section");
                    }}
                    disabled={savingProfile || yearSectionLockInfo.locked}
                  >
                    <option value="">Not set</option>
                    <option value="1st Year">1st Year</option>
                    <option value="2nd Year">2nd Year</option>
                    <option value="3rd Year">3rd Year</option>
                    <option value="4th Year">4th Year</option>
                    <option value="5th Year">5th Year</option>
                  </select>
                  <small>
                    {yearSectionLockInfo.locked
                      ? `Locked until ${yearSectionLockInfo.nextDate}. Ask an admin for corrections.`
                      : "Can be changed once per year."}
                  </small>
                  {profileFieldErrors.yearLevel && (
                    <p className="field-error-message">
                      {profileFieldErrors.yearLevel}
                    </p>
                  )}
                </div>

                <div className="settings-field">
                  <label className="qb-label" htmlFor="section">
                    Section
                  </label>
                  <input
                    id="section"
                    type="text"
                    className={profileFieldErrors.section ? "input-error" : ""}
                    placeholder="Example: BSCS 3A"
                    value={section}
                    onFocus={() => clearProfileFieldError("section")}
                    onChange={(event) => {
                      markProfileChanged();
                      setSection(event.target.value);
                      clearProfileFieldError("section");
                      clearProfileFieldError("yearLevel");
                    }}
                    disabled={savingProfile || yearSectionLockInfo.locked}
                  />
                  <small>
                    {yearSectionLockInfo.locked
                      ? `Locked until ${yearSectionLockInfo.nextDate}. Ask an admin for corrections.`
                      : "Can be changed once per year."}
                  </small>
                  {profileFieldErrors.section && (
                    <p className="field-error-message">
                      {profileFieldErrors.section}
                    </p>
                  )}
                </div>

                <div className="settings-field">
                  <label className="qb-label" htmlFor="mobile-number">
                    Mobile Number
                  </label>
                  <input
                    id="mobile-number"
                    type="tel"
                    className={profileFieldErrors.mobileNumber ? "input-error" : ""}
                    placeholder="Example: 09123456789"
                    value={mobileNumber}
                    onFocus={() => clearProfileFieldError("mobileNumber")}
                    onBlur={() => validateProfileField("mobileNumber")}
                    onChange={(event) => {
                      const sanitizedMobileNumber = sanitizeMobileNumberInput(
                        event.target.value
                      );

                      markProfileChanged();
                      setMobileNumber(sanitizedMobileNumber);
                      clearProfileFieldError("mobileNumber");
                    }}
                    disabled={savingProfile || mobileNumberLockInfo.locked}
                  />
                  <small>
                    {mobileNumberLockInfo.locked
                      ? `Locked until ${mobileNumberLockInfo.nextDate}. Ask an admin for corrections.`
                      : "Can be changed once per month."}
                  </small>
                  {profileFieldErrors.mobileNumber && (
                    <p className="field-error-message">
                      {profileFieldErrors.mobileNumber}
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}

          <button
            type="submit"
            className="settings-primary-btn"
            disabled={savingProfile}
          >
            {savingProfile ? "Saving..." : "Save Settings"}
          </button>
        </form>

        {borrowingStatusInfo && (
          <section
            className={`settings-card settings-borrowing-status-card status-${borrowingStatusInfo.tone}`}
            aria-label="Borrowing status"
          >
            <div className="settings-section-heading">
              <h2>Borrowing Status</h2>
              <p>Check your borrowing access, restriction reason, and ending time.</p>
            </div>

            <div className="settings-borrowing-status-main">
              <span>{borrowingStatusInfo.label}</span>
              <strong>{borrowingStatusInfo.canBorrow}</strong>
            </div>

            <div className="settings-borrowing-status-grid">
              <div>
                <span>Restriction Ends</span>
                <strong>{borrowingStatusInfo.until}</strong>
              </div>

              <div>
                <span>Reason</span>
                <strong>{borrowingStatusInfo.reason}</strong>
              </div>
            </div>

            <p className="settings-borrowing-status-note">
              {borrowingStatusInfo.detail}
            </p>
          </section>
        )}

        {isBorrowerProfile() && (
          <section className="settings-card settings-penalty-history-card">
            <div className="settings-section-heading">
              <h2>Penalty History</h2>
              <p>
                View your temporary borrowing restriction records and the item
                that caused each restriction.
              </p>
            </div>

            {getSortedPenaltyRecords().length === 0 ? (
              <div className="settings-penalty-empty">
                <strong>No penalty records</strong>
                <p>You have no recorded borrowing restriction history.</p>
              </div>
            ) : (
              <div className="settings-penalty-list">
                {getSortedPenaltyRecords()
                  .slice(0, 5)
                  .map((record) => (
                    <article className="settings-penalty-item" key={record.id}>
                      <div className="settings-penalty-item-head">
                        <div>
                          <span>{record.penaltyType || "Borrowing Restriction"}</span>
                          <strong>{record.itemName || "No item linked"}</strong>
                        </div>

                        <em className={`penalty-status-${getPenaltyStatusClass(record)}`}>
                          {getPenaltyStatusLabel(record)}
                        </em>
                      </div>

                      <p>{record.reason || "No reason recorded."}</p>

                      <div className="settings-penalty-meta">
                        <span>Started: {formatPenaltyDateTime(record.restrictionStartAt || record.createdAt)}</span>
                        <span>Ends: {formatPenaltyDateTime(record.restrictionEndAt)}</span>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>
        )}



        {isSuperAdminProfile() && (
          <section
            className={`settings-card settings-school-status-card ${
              isSchoolClosed() ? "closed" : "open"
            }`}
            aria-label="School availability control"
          >
            <div className="settings-section-heading">
              <h2>School Availability</h2>
              <p>
                Control same-day school closure mode. This disables new borrow
                requests, item release, and return confirmation, but timers
                continue running.
              </p>
            </div>

            <div className="settings-school-status-main">
              <span>{isSchoolClosed() ? "Closed" : "Open"}</span>
              <strong>
                {isSchoolClosed()
                  ? "Borrowing, release, and returns are unavailable"
                  : "Borrowing, release, and returns are available"}
              </strong>
            </div>

            <div className="settings-school-status-grid">
              <div>
                <span>Closure Reason</span>
                <strong>
                  {schoolStatus?.closureReason || "No active closure reason"}
                </strong>
              </div>

              <div>
                <span>Last Updated</span>
                <strong>
                  {formatSchoolTimestamp(
                    schoolStatus?.updatedAt ||
                      schoolStatus?.closedAt ||
                      schoolStatus?.reopenedAt
                  )}
                </strong>
              </div>
            </div>

            <div className="settings-field settings-school-reason-field">
              <label className="qb-label" htmlFor="school-closure-reason">
                Closure Reason
              </label>

              <textarea
                id="school-closure-reason"
                value={schoolClosureReason}
                onChange={(event) => setSchoolClosureReason(event.target.value)}
                placeholder="Optional: Example: Campus maintenance, office unavailable, school activity"
                disabled={savingSchoolStatus}
              />

            <small>
              Optional. If left blank, the system will show: “School is closed today.
              Please come back tomorrow.” Timers continue running in this mode.
            </small>
            </div>

            <div className="settings-school-status-actions">
              <button
                type="button"
                className="settings-secondary-btn"
                onClick={() => handleUpdateSchoolStatus(false)}
                disabled={savingSchoolStatus || !isSchoolClosed()}
              >
                {savingSchoolStatus ? "Saving..." : "Reopen Borrowing"}
              </button>

              <button
                type="button"
                className="settings-primary-btn settings-close-school-btn"
                onClick={() => handleUpdateSchoolStatus(true)}
                disabled={savingSchoolStatus || isSchoolClosed()}
              >
                {savingSchoolStatus ? "Saving..." : "Pause Borrowing Today"}
              </button>
            </div>
          </section>
        )}

{isSuperAdminProfile() && (
  <section
    className={`settings-card settings-system-suspension-card ${
      isSystemSuspended() ? "status-danger" : "status-success"
    }`}
  >
    <div className="settings-section-heading">
      <h2>System Suspension</h2>
      <p>
        Use this for typhoons, calamities, holidays, or official suspensions.
        This pauses borrowing workflows and also pauses borrowing time.
      </p>
    </div>

    <div className="settings-borrowing-status-main">
      <span>System Status</span>
      <strong>
        {isSystemSuspended()
          ? "Suspended / Paused"
          : "Running Normally"}
      </strong>
    </div>

    <div className="settings-school-status-grid">
      <div>
        <span>Suspension Reason</span>
        <strong>
          {schoolStatus?.systemSuspensionReason ||
            "No active system suspension reason"}
        </strong>
      </div>

      <div>
        <span>Last Updated</span>
        <strong>
          {formatSchoolTimestamp(
            schoolStatus?.updatedAt ||
              schoolStatus?.systemSuspendedAt ||
              schoolStatus?.systemResumedAt
          )}
        </strong>
      </div>
    </div>

    <div className="settings-field settings-school-reason-field">
      <label className="qb-label" htmlFor="system-suspension-reason">
        Suspension Reason
      </label>

      <textarea
        id="system-suspension-reason"
        value={systemSuspensionReason}
        onChange={(event) => setSystemSuspensionReason(event.target.value)}
        placeholder="Example: Typhoon, calamity, holiday, official class suspension"
        disabled={savingSystemSuspension}
      />

      <small>
        This pauses request expiration, claim deadlines, return deadlines, and
        overdue counting until the system is resumed.
      </small>
    </div>

    <div className="settings-school-status-actions">
      <button
        type="button"
        className="settings-secondary-btn"
        onClick={() => handleUpdateSystemSuspensionStatus(false)}
        disabled={savingSystemSuspension || !isSystemSuspended()}
      >
        {savingSystemSuspension ? "Saving..." : "Resume System"}
      </button>

      <button
        type="button"
        className="settings-primary-btn settings-close-school-btn"
        onClick={() => handleUpdateSystemSuspensionStatus(true)}
        disabled={savingSystemSuspension || isSystemSuspended()}
      >
        {savingSystemSuspension ? "Saving..." : "Suspend System"}
      </button>
    </div>
  </section>
)}
        <form
          className="settings-card settings-password-card"
          onSubmit={handleChangePassword}
          noValidate
        >
          <div className="settings-section-heading">
            <h2>Change Password</h2>
            <p>Confirm your current password before setting a new one.</p>
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="current-password">
              Current Password <span className="required-star">*</span>
            </label>

            <input
              id="current-password"
              type="password"
              className={passwordFieldErrors.passwordCurrent ? "input-error" : ""}
              placeholder="Current password"
              value={passwordCurrent}
              onFocus={() => clearPasswordFieldError("passwordCurrent")}
              onBlur={() => validatePasswordField("passwordCurrent")}
              onChange={(event) => {
                markPasswordChanged();
                setPasswordCurrent(event.target.value);
                clearPasswordFieldError("passwordCurrent");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.passwordCurrent && (
              <p className="field-error-message">
                {passwordFieldErrors.passwordCurrent}
              </p>
            )}
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="new-password">
              New Password <span className="required-star">*</span>
            </label>

            <input
              id="new-password"
              type="password"
              className={passwordFieldErrors.newPassword ? "input-error" : ""}
              placeholder="At least 6 characters"
              value={newPassword}
              onFocus={() => clearPasswordFieldError("newPassword")}
              onBlur={() => validatePasswordField("newPassword")}
              onChange={(event) => {
                markPasswordChanged();
                setNewPassword(event.target.value);
                clearPasswordFieldError("newPassword");
                clearPasswordFieldError("confirmNewPassword");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.newPassword && (
              <p className="field-error-message">{passwordFieldErrors.newPassword}</p>
            )}
          </div>

          <div className="settings-field">
            <label className="qb-label" htmlFor="confirm-new-password">
              Confirm Password <span className="required-star">*</span>
            </label>

            <input
              id="confirm-new-password"
              type="password"
              className={passwordFieldErrors.confirmNewPassword ? "input-error" : ""}
              placeholder="Repeat new password"
              value={confirmNewPassword}
              onFocus={() => clearPasswordFieldError("confirmNewPassword")}
              onBlur={() => validatePasswordField("confirmNewPassword")}
              onChange={(event) => {
                markPasswordChanged();
                setConfirmNewPassword(event.target.value);
                clearPasswordFieldError("confirmNewPassword");
              }}
              disabled={changingPassword}
            />

            {passwordFieldErrors.confirmNewPassword && (
              <p className="field-error-message">
                {passwordFieldErrors.confirmNewPassword}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="settings-secondary-btn"
            disabled={changingPassword}
          >
            {changingPassword ? "Changing..." : "Change Password"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default Settings;
