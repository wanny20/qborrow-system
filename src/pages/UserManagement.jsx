import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query as firestoreQuery,
  orderBy,
  limit,
  startAfter,
  where,
  getCountFromServer,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, secondaryAuth, functions } from "../firebase/firebaseConfig";
import { useToast } from "../components/ToastContext.jsx";
import ConfirmActionModal from "../components/ConfirmActionModal.jsx";
import "../styles/UserManagement.css";

const USERS_PAGE_SIZE = 5;
const USER_TYPES = ["Student", "Faculty", "Staff"];
const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

const CATEGORY_NAME_MAX_LENGTH = 50;
// Letters and spaces only - no numbers, no symbols/punctuation, no emoji.
const CATEGORY_NAME_ALLOWED_PATTERN = /^[A-Za-z ]+$/;

// Edit User modal field limits - Full Name: 50 chars, letters/spaces only.
const EDIT_FULL_NAME_MAX_LENGTH = 50;
const EDIT_FULL_NAME_ALLOWED_PATTERN = /^[\p{L}][\p{L}\s]*$/u;
// Edit User modal field limits - Student Number: 20 digits only, no letters/symbols.
const STUDENT_NUMBER_MAX_LENGTH = 20;
const STUDENT_NUMBER_ALLOWED_PATTERN = /^[0-9]*$/;
// Edit User modal field limits - Section: 50 chars, letters/numbers/spaces, no symbols.
const SECTION_MAX_LENGTH = 50;
const SECTION_ALLOWED_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}\s]*$/u;
// Broad emoji / pictograph detection so a clearer message can be shown
// instead of falling through to the generic "symbol" error.
const EMOJI_PATTERN =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/u;
// Requests still "in flight" - renaming a category while one of these is
// open could make the request look wrong mid-transaction to the borrower
// or the approving admin. Returned/Rejected/Cancelled/Expired are done
// and safe to leave untouched.
const ACTIVE_REQUEST_STATUSES = ["Pending", "Approved", "Borrowed"];

function UserManagement() {
const navigate = useNavigate();
const outletContext = useOutletContext() || {};
const {
  userData: currentAdmin,
  setUnsavedChanges,
  guardedNavigate,
} = outletContext;
const { showToast } = useToast();
const [searchParams, setSearchParams] = useSearchParams();
const createUserSubmitLockRef = useRef(false);


  const [users, setUsers] = useState([]);
  const [lastUserDoc, setLastUserDoc] = useState(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);

  const [userStats, setUserStats] = useState({
  total: 0,
  borrowers: 0,
  categoryAdmins: 0,
  superAdmins: 0,
  suspended: 0,
});

  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [borrowRequests, setBorrowRequests] = useState([]);
  const [penaltyRecords, setPenaltyRecords] = useState([]);
  const [categoryAdminAssignments, setCategoryAdminAssignments] = useState([]);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [categoryAction, setCategoryAction] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [role, setRole] = useState("borrower");
  const [assignedCategories, setAssignedCategories] = useState([]);

  const [userType, setUserType] = useState("Student");
  const [studentNumber, setStudentNumber] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [courseDepartment, setCourseDepartment] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [section, setSection] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");

  const [newCategoryName, setNewCategoryName] = useState("");
  const [showCategoryList, setShowCategoryList] = useState(false);
  const [activeUserTool, setActiveUserTool] = useState("");

  const [editingCategory, setEditingCategory] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [categoryEditFieldErrors, setCategoryEditFieldErrors] = useState({});
  const [savingCategoryEdit, setSavingCategoryEdit] = useState(false);

  const [csvFileName, setCsvFileName] = useState("");
  const [csvBorrowers, setCsvBorrowers] = useState([]);
  const [importResults, setImportResults] = useState([]);

  const [editingUserId, setEditingUserId] = useState("");
  const [viewingUser, setViewingUser] = useState(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("borrower");
  const [editAssignedCategories, setEditAssignedCategories] = useState([]);

  const [editUserType, setEditUserType] = useState("Student");
  const [editStudentNumber, setEditStudentNumber] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editCourseDepartment, setEditCourseDepartment] = useState("");
  const [editYearLevel, setEditYearLevel] = useState("");
  const [editSection, setEditSection] = useState("");
  const [editMobileNumber, setEditMobileNumber] = useState("");

  const [editNewPassword, setEditNewPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");
  const [showEditNewPassword, setShowEditNewPassword] = useState(false);
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({});
  const [settingPasswordId, setSettingPasswordId] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState({});
  const [categoryFieldErrors, setCategoryFieldErrors] = useState({});
  const [csvFieldErrors, setCsvFieldErrors] = useState({});
  const [editFieldErrors, setEditFieldErrors] = useState({});

  const [createTouched, setCreateTouched] = useState(false);
const [categoryTouched, setCategoryTouched] = useState(false);
const [csvTouched, setCsvTouched] = useState(false);
const [editTouched, setEditTouched] = useState(false);
const [showToolCloseConfirm, setShowToolCloseConfirm] = useState(false);
const [confirmAction, setConfirmAction] = useState(null);
const [confirmActionLoading, setConfirmActionLoading] = useState(false);

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

  function showActionError(shortMessage, error) {
  const detailedMessage = error?.message
    ? `${shortMessage}: ${error.message}`
    : shortMessage;

  showStatus(detailedMessage, "error");
  showToast(shortMessage, "error");
}

function showBlockedAction(message) {
  showStatus(message, "error");
  showToast(message, "error");
}
function openConfirmAction(config) {
  setConfirmAction(config);
}

function closeConfirmAction() {
  if (confirmActionLoading) return;
  setConfirmAction(null);
}

async function runConfirmAction() {
  if (!confirmAction?.onConfirm) return;

  setConfirmActionLoading(true);

  try {
    await confirmAction.onConfirm();
    setConfirmAction(null);
  } finally {
    setConfirmActionLoading(false);
  }
}

function markCreateChanged() {
  setCreateTouched(true);
}

function markCategoryChanged() {
  setCategoryTouched(true);
}

function markCsvChanged() {
  setCsvTouched(true);
}

function markEditChanged() {
  setEditTouched(true);
}

function hasUnsavedUserToolChanges() {
  if (activeUserTool === "create") return createTouched;
  if (activeUserTool === "categories") return categoryTouched;
  if (activeUserTool === "import") return csvTouched;

  return false;
}

function resetCurrentUserToolChanges() {
  if (activeUserTool === "create") {
    resetCreateForm();
  }

  if (activeUserTool === "categories") {
    setNewCategoryName("");
    setCategoryFieldErrors({});
    setCategoryTouched(false);
  }

  if (activeUserTool === "import") {
    clearCsvImport();
    setCsvFieldErrors({});
    setCsvTouched(false);
  }
}

function closeUserToolModal() {
  if (hasUnsavedUserToolChanges()) {
    setShowToolCloseConfirm(true);
    return;
  }

  setActiveUserTool("");
  setSearchParams({});
}

function cancelCloseUserToolModal() {
  setShowToolCloseConfirm(false);
}

function goToUserManagementHome() {
  if (guardedNavigate) {
    guardedNavigate("/user-management");
    return;
  }

  setActiveUserTool("");
  setSearchParams({});
}

function goToDashboard() {
  if (guardedNavigate) {
    guardedNavigate("/dashboard");
    return;
  }

  navigate("/dashboard");
}

function confirmCloseUserToolModal() {
  resetCurrentUserToolChanges();
  setShowToolCloseConfirm(false);
  setActiveUserTool("");
  setSearchParams({});
}

  function clearCreateFieldError(fieldName) {
  setCreateFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateCreateField(fieldName) {
  setCreateFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "fullName") {
      const fullNameError = getPersonNameError(fullName);

      if (fullNameError) {
        nextErrors.fullName = fullNameError;
      } else {
        delete nextErrors.fullName;
      }
    }

    if (fieldName === "email") {
      if (!email.trim()) {
        nextErrors.email = "Email is required.";
      } else if (!isValidEmail(email)) {
        nextErrors.email = "Please enter a valid email address.";
      } else {
        delete nextErrors.email;
      }
    }

    if (fieldName === "temporaryPassword") {
      if (!temporaryPassword.trim()) {
        nextErrors.temporaryPassword = "Temporary password is required.";
      } else if (temporaryPassword.length < 6) {
        nextErrors.temporaryPassword =
          "Temporary password must be at least 6 characters.";
      } else {
        delete nextErrors.temporaryPassword;
      }
    }

    if (fieldName === "role") {
      if (!role) {
        nextErrors.role = "Role is required.";
      } else {
        delete nextErrors.role;
      }
    }

    if (fieldName === "assignedCategories") {
      if (role === "categoryAdmin" && categories.length === 0) {
        nextErrors.assignedCategories = "Please add or seed categories first.";
      } else if (
        role === "categoryAdmin" &&
        getAvailableCategoryCountForCategoryAdmin() === 0 &&
        assignedCategories.length === 0
      ) {
        nextErrors.assignedCategories =
          "All categories are already assigned to another mini admin.";
      } else if (role === "categoryAdmin" && assignedCategories.length === 0) {
        nextErrors.assignedCategories =
          "Please assign one available category for this mini admin.";
      } else if (role === "categoryAdmin" && assignedCategories.length > 1) {
        nextErrors.assignedCategories =
          "Mini admin can only manage one category.";
      } else if (
        role === "categoryAdmin" &&
        isCategoryAssignedToAnotherAdmin(assignedCategories[0])
      ) {
        nextErrors.assignedCategories =
          getCategoryAlreadyAssignedMessage(assignedCategories[0]);
      } else {
        delete nextErrors.assignedCategories;
      }
    }

    return nextErrors;
  });
}

function clearCategoryFieldError(fieldName) {
  setCategoryFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateCategoryField(fieldName) {
  setCategoryFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "newCategoryName") {
      const error = getCategoryNameError(newCategoryName);

      if (error) {
        nextErrors.newCategoryName = error;
      } else {
        delete nextErrors.newCategoryName;
      }
    }

    return nextErrors;
  });
}

function clearCsvFieldError(fieldName) {
  setCsvFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}
function validateCsvField(fieldName) {
  setCsvFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "borrowerCsv") {
      if (csvBorrowers.length === 0) {
        nextErrors.borrowerCsv = "Please select a valid CSV file first.";
      } else {
        delete nextErrors.borrowerCsv;
      }
    }

    return nextErrors;
  });
}
function clearEditFieldError(fieldName) {
  setEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}
function validateEditUserField(fieldName) {
  setEditFieldErrors((previousErrors) => {
    const nextErrors = { ...previousErrors };

    if (fieldName === "editFullName") {
      const editFullNameError = getEditFullNameError(editFullName);

      if (editFullNameError) {
        nextErrors.editFullName = editFullNameError;
      } else {
        delete nextErrors.editFullName;
      }
    }

    if (fieldName === "editStudentNumber") {
      const editStudentNumberError = getStudentNumberError(editStudentNumber);

      if (editStudentNumberError) {
        nextErrors.editStudentNumber = editStudentNumberError;
      } else {
        delete nextErrors.editStudentNumber;
      }
    }

    if (fieldName === "editSection") {
      const editSectionError = getSectionError(editSection);

      if (editSectionError) {
        nextErrors.editSection = editSectionError;
      } else {
        delete nextErrors.editSection;
      }
    }

    if (fieldName === "editEmail") {
      if (!editEmail.trim()) {
        nextErrors.editEmail = "Email is required.";
      } else if (!isValidEmail(editEmail)) {
        nextErrors.editEmail = "Please enter a valid email address.";
      } else {
        delete nextErrors.editEmail;
      }
    }

    if (fieldName === "editRole") {
      const editingUser = users.find((user) => user.id === editingUserId);

      if (!editRole) {
        nextErrors.editRole = "Role is required.";
      } else if (
        editingUser?.role === "borrower" &&
        (editRole === "categoryAdmin" || editRole === "superAdmin") &&
        getActiveBorrowRequestCountForUser(editingUserId) > 0
      ) {
        nextErrors.editRole =
          "This borrower has an active borrow request and cannot be switched to an admin role until it is returned, rejected, or cancelled.";
      } else {
        delete nextErrors.editRole;
      }
    }

    if (fieldName === "editAssignedCategories") {
      if (editRole === "categoryAdmin" && categories.length === 0) {
        nextErrors.editAssignedCategories = "Please add or seed categories first.";
      } else if (
        editRole === "categoryAdmin" &&
        getAvailableCategoryCountForCategoryAdmin(editingUserId) === 0 &&
        editAssignedCategories.length === 0
      ) {
        nextErrors.editAssignedCategories =
          "All categories are already assigned to another mini admin.";
      } else if (
        editRole === "categoryAdmin" &&
        editAssignedCategories.length === 0
      ) {
        nextErrors.editAssignedCategories =
          "Mini admin must have one assigned category.";
      } else if (
        editRole === "categoryAdmin" &&
        editAssignedCategories.length > 1
      ) {
        nextErrors.editAssignedCategories =
          "Mini admin can only manage one category.";
      } else if (
        editRole === "categoryAdmin" &&
        isCategoryAssignedToAnotherAdmin(
          editAssignedCategories[0],
          editingUserId
        )
      ) {
        nextErrors.editAssignedCategories =
          getCategoryAlreadyAssignedMessage(
            editAssignedCategories[0],
            editingUserId
          );
      } else {
        delete nextErrors.editAssignedCategories;
      }
    }

    return nextErrors;
  });
}

function validateEditUserForm() {
  const errors = {};

  const editFullNameError = getEditFullNameError(editFullName);

  if (editFullNameError) {
    errors.editFullName = editFullNameError;
  }

  if (editRole === "borrower" && editUserType === "Student") {
    const editStudentNumberError = getStudentNumberError(editStudentNumber);

    if (editStudentNumberError) {
      errors.editStudentNumber = editStudentNumberError;
    }

    const editSectionError = getSectionError(editSection);

    if (editSectionError) {
      errors.editSection = editSectionError;
    }
  }

  if (!editEmail.trim()) {
    errors.editEmail = "Email is required.";
  } else if (!isValidEmail(editEmail)) {
    errors.editEmail = "Please enter a valid email address.";
  }

  if (!editRole) {
    errors.editRole = "Role is required.";
  } else {
    const editingUser = users.find((user) => user.id === editingUserId);

    if (
      editingUser?.role === "borrower" &&
      (editRole === "categoryAdmin" || editRole === "superAdmin") &&
      getActiveBorrowRequestCountForUser(editingUserId) > 0
    ) {
      errors.editRole =
        "This borrower has an active borrow request and cannot be switched to an admin role until it is returned, rejected, or cancelled.";
    }
  }

  if (editRole === "categoryAdmin" && categories.length === 0) {
    errors.editAssignedCategories = "Please add or seed categories first.";
  } else if (
    editRole === "categoryAdmin" &&
    getAvailableCategoryCountForCategoryAdmin(editingUserId) === 0 &&
    editAssignedCategories.length === 0
  ) {
    errors.editAssignedCategories =
      "All categories are already assigned to another mini admin.";
  } else if (
    editRole === "categoryAdmin" &&
    editAssignedCategories.length === 0
  ) {
    errors.editAssignedCategories =
      "Mini admin must have one assigned category.";
  } else if (
    editRole === "categoryAdmin" &&
    editAssignedCategories.length > 1
  ) {
    errors.editAssignedCategories =
      "Mini admin can only manage one category.";
  } else if (
    editRole === "categoryAdmin" &&
    isCategoryAssignedToAnotherAdmin(editAssignedCategories[0], editingUserId)
  ) {
    errors.editAssignedCategories = getCategoryAlreadyAssignedMessage(
      editAssignedCategories[0],
      editingUserId
    );
  }

  setEditFieldErrors(errors);

  return Object.keys(errors).length === 0;
}
async function getCreateDuplicateError() {
  const usersRef = collection(db, "users");
  const cleanedEmail = email.trim().toLowerCase();

  if (cleanedEmail) {
    const emailSnapshot = await getDocs(
      firestoreQuery(usersRef, where("email", "==", cleanedEmail), limit(1))
    );

    if (!emailSnapshot.empty) {
      return "This email is already registered. Please use a different email address.";
    }
  }

  if (role === "categoryAdmin") {
    if (assignedCategories.length > 1) {
      return "Mini admin can only manage one category.";
    }

    const categoryConflict = await getCategoryAssignmentConflictFromServer(
      assignedCategories[0]
    );

    if (categoryConflict) {
      return categoryConflict;
    }
  }

  if (role === "borrower") {
    const safeUserType = getSafeUserType(userType);

    if (safeUserType === "Student") {
      const cleanedStudentNumber = cleanInput(studentNumber);

      if (cleanedStudentNumber) {
        const studentNumberSnapshot = await getDocs(
          firestoreQuery(
            usersRef,
            where("studentNumber", "==", cleanedStudentNumber),
            limit(1)
          )
        );

        if (!studentNumberSnapshot.empty) {
          return "This student number is already registered. Students with the same name are allowed, but student numbers must be unique.";
        }
      }
    }

    if (safeUserType === "Faculty" || safeUserType === "Staff") {
      const cleanedEmployeeId = cleanInput(employeeId);

      if (cleanedEmployeeId) {
        const employeeIdSnapshot = await getDocs(
          firestoreQuery(
            usersRef,
            where("employeeId", "==", cleanedEmployeeId),
            limit(1)
          )
        );

        if (!employeeIdSnapshot.empty) {
          return "This employee ID is already registered. Faculty/staff names may repeat, but employee IDs must be unique.";
        }
      }
    }
  }

  return "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

async function getEditDuplicateError(userId) {
  const cleanedEmail = editEmail.trim().toLowerCase();

  if (cleanedEmail) {
    const usersRef = collection(db, "users");
    const emailSnapshot = await getDocs(
      firestoreQuery(usersRef, where("email", "==", cleanedEmail), limit(1))
    );

    const emailTakenByAnotherUser = emailSnapshot.docs.some(
      (docSnapshot) => docSnapshot.id !== userId
    );

    if (emailTakenByAnotherUser) {
      return "This email is already registered. Please use a different email address.";
    }
  }

  return "";
}

function validateCreateUserForm() {
  const errors = {};

const fullNameError = getPersonNameError(fullName);

if (fullNameError) {
  errors.fullName = fullNameError;
}

  if (!email.trim()) {
    errors.email = "Email is required.";
  } else if (!isValidEmail(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (!temporaryPassword.trim()) {
    errors.temporaryPassword = "Temporary password is required.";
  } else if (temporaryPassword.length < 6) {
    errors.temporaryPassword = "Temporary password must be at least 6 characters.";
  }

  if (!role) {
    errors.role = "Role is required.";
  }

  if (role === "categoryAdmin" && categories.length === 0) {
    errors.assignedCategories = "Please add or seed categories first.";
  } else if (
    role === "categoryAdmin" &&
    getAvailableCategoryCountForCategoryAdmin() === 0 &&
    assignedCategories.length === 0
  ) {
    errors.assignedCategories =
      "All categories are already assigned to another mini admin.";
  } else if (role === "categoryAdmin" && assignedCategories.length === 0) {
    errors.assignedCategories =
      "Please assign one available category for this mini admin.";
  } else if (role === "categoryAdmin" && assignedCategories.length > 1) {
    errors.assignedCategories =
      "Mini admin can only manage one category.";
  } else if (
    role === "categoryAdmin" &&
    isCategoryAssignedToAnotherAdmin(assignedCategories[0])
  ) {
    errors.assignedCategories = getCategoryAlreadyAssignedMessage(
      assignedCategories[0]
    );
  }

  setCreateFieldErrors(errors);

  return Object.keys(errors).length === 0;
}




function validateAddCategoryForm() {
  const error = getCategoryNameError(newCategoryName);

  setCategoryFieldErrors(error ? { newCategoryName: error } : {});

  return !error;
}

// Shared rule check for both adding and renaming a category.
// excludeCategoryId lets the currently-edited category skip the
// "duplicate name" check against itself.
function getCategoryNameError(rawName, excludeCategoryId) {
  const trimmedName = String(rawName || "").trim();

  if (!trimmedName) {
    return "Category name is required.";
  }

  if (trimmedName.length > CATEGORY_NAME_MAX_LENGTH) {
    return `Category name must be ${CATEGORY_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (EMOJI_PATTERN.test(trimmedName)) {
    return "Emoji are not allowed in category names.";
  }

  if (!CATEGORY_NAME_ALLOWED_PATTERN.test(trimmedName)) {
    return "Only letters and spaces are allowed (no numbers or symbols).";
  }

  const isDuplicate = categories.some(
    (category) =>
      category.id !== excludeCategoryId &&
      normalizeText(category.name) === normalizeText(trimmedName)
  );

  if (isDuplicate) {
    return "A category with this name already exists.";
  }

  return "";
}

function clearCategoryEditFieldError(fieldName) {
  setCategoryEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateCategoryEditField() {
  const error = getCategoryNameError(editCategoryName, editingCategory?.id);

  setCategoryEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    editCategoryName: error,
  }));

  return error;
}

function validateEditCategoryForm() {
  const error = getCategoryNameError(editCategoryName, editingCategory?.id);

  setCategoryEditFieldErrors(error ? { editCategoryName: error } : {});

  return !error;
}

function startEditingCategory(category) {
  const usage = getCategoryUsage(category.id);

  if (!usage.canEditName) return;

  setEditingCategory(category);
  setEditCategoryName(category.name || "");
  setCategoryEditFieldErrors({});
}

function cancelEditingCategory() {
  if (savingCategoryEdit) return;

  setEditingCategory(null);
  setEditCategoryName("");
  setCategoryEditFieldErrors({});
}

async function handleUpdateCategoryName(event) {
  event.preventDefault();

  if (!editingCategory) return;

  const usage = getCategoryUsage(editingCategory.id);

  if (!usage.canEditName) {
    showBlockedAction(
      "This category now has an active borrow request. Try again once it's resolved."
    );
    cancelEditingCategory();
    return;
  }

  const isValid = validateEditCategoryForm();

  if (!isValid) return;

  const trimmedName = editCategoryName.trim();

  if (trimmedName === editingCategory.name) {
    cancelEditingCategory();
    return;
  }

  setSavingCategoryEdit(true);
  showStatus("", "");

  try {
    await updateDoc(doc(db, "categories", editingCategory.id), {
      name: trimmedName,
    });

    showToast("Category Updated", "success");
    setEditingCategory(null);
    setEditCategoryName("");
    setCategoryEditFieldErrors({});
    fetchData();
  } catch (error) {
    showActionError("Failed to update category", error);
  } finally {
    setSavingCategoryEdit(false);
  }
}

function validateCsvImportForm() {
  const errors = {};

  if (csvBorrowers.length === 0) {
    errors.borrowerCsv = "Please select a valid CSV file first.";
  }

  setCsvFieldErrors(errors);

  return Object.keys(errors).length === 0;
}
  function cleanInput(value) {
    return String(value || "").trim();
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getSafeUserType(value) {
    const cleanedValue = cleanInput(value);

    return USER_TYPES.includes(cleanedValue) ? cleanedValue : "Student";
  }
  function formatCreatedAt(value) {
  if (!value) return "Not set";

  if (typeof value?.toDate === "function") {
    return value.toDate().toLocaleDateString();
  }

  if (typeof value === "string") {
    return value || "Not set";
  }

  return "Not set";
}

  function formatSuspendedUntil(value) {
    const suspendedDate = getDateFromValue(value);

    if (!suspendedDate) return "Not suspended";

    return suspendedDate.toLocaleDateString();
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

 function isUserSuspended(user) {
  const suspendedDate = getDateFromValue(user?.suspendedUntil);

  if (!suspendedDate) {
    return false;
  }

  return suspendedDate > new Date();
}

function isBorrowingRestrictionActive(user) {
  if (user?.role !== "borrower") return false;
  if (user?.canBorrow !== false) return false;

  const suspendedDate = getDateFromValue(user?.suspendedUntil);

  // No end date means manual borrowing disable.
  if (!suspendedDate) return true;

  return suspendedDate > new Date();
}

function getRestrictionEndsLabel(user) {
  if (user?.role !== "borrower") return "N/A";

  if (!isBorrowingRestrictionActive(user)) {
    return "None";
  }

  const suspendedDate = getDateFromValue(user?.suspendedUntil);

  if (!suspendedDate) {
    return "No end date";
  }

  return suspendedDate.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function shouldShowRestrictionReason(user) {
  return (
    isBorrowingRestrictionActive(user) &&
    Boolean(String(user?.suspensionReason || "").trim())
  );
}

function getPenaltyDate(value) {
  const date = getDateFromValue(value);

  if (!date) return null;

  return date;
}

function formatPenaltyDateTime(value) {
  const date = getPenaltyDate(value);

  if (!date) return "Not recorded";

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getActiveBorrowRequestCountForUser(userId) {
  if (!userId) return 0;

  return borrowRequests.filter(
    (request) =>
      request.borrowerId === userId &&
      ACTIVE_REQUEST_STATUSES.includes(request.approvalStatus)
  ).length;
}

function getPenaltyRecordsForUser(userId) {
  if (!userId) return [];

  return penaltyRecords
    .filter((record) => record.borrowerId === userId)
    .sort((a, b) => {
      const firstDate = getPenaltyDate(a.createdAt)?.getTime() || 0;
      const secondDate = getPenaltyDate(b.createdAt)?.getTime() || 0;

      return secondDate - firstDate;
    });
}

function getPenaltyStatusLabel(record) {
  if (record?.status === "Resolved") return "Resolved";

  const restrictionEndDate = getPenaltyDate(record?.restrictionEndAt);

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

async function resolveActivePenaltyRecordsForUser(user, resolutionReason) {
  if (!user?.id) return;

  const penaltyQuery = firestoreQuery(
    collection(db, "penaltyRecords"),
    where("borrowerId", "==", user.id)
  );

  const penaltySnapshot = await getDocs(penaltyQuery);
  const activePenaltyRecords = penaltySnapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .filter((record) => getPenaltyStatusLabel(record) === "Active");

  await Promise.allSettled(
    activePenaltyRecords.map((record) =>
      updateDoc(doc(db, "penaltyRecords", record.id), {
        status: "Resolved",
        resolvedAt: serverTimestamp(),
        resolvedBy: currentAdmin?.uid || "",
        resolvedByEmail: currentAdmin?.email || "",
        resolutionReason,
        updatedAt: serverTimestamp(),
      })
    )
  );
}

function isTemporaryBorrowingRestriction(user) {
  if (user?.role !== "borrower") return false;
  if (user?.canBorrow !== false) return false;

  const reason = String(user?.suspensionReason || "").toLowerCase();

  return (
    reason.includes("temporary borrowing restriction") ||
    reason.includes("approved item") ||
    reason.includes("claimed/released")
  );
}

// Deliberately still keyed off the raw canBorrow flag, not
// isBorrowingRestrictionActive(): "Restore Access" is the safe, side-effect-
// free cleanup action (just clears the stale flags, doesn't touch
// overdueCount). That's exactly what you want for a user whose timed
// restriction already expired but whose canBorrow is still stuck at false.
// Gating this on expiration instead would push that same user onto the
// "Reset Suspension" path, which also zeroes their overdueCount - an
// unrelated, more destructive action nobody asked for here.
function shouldShowRestoreBorrowingAccess(user) {
  return user?.role === "borrower" && user?.canBorrow === false;
}

function getBorrowingStatusLabel(user) {
  if (user?.role !== "borrower") {
    return user?.isActive === false ? "Account Disabled" : "Active";
  }

  // canBorrow/suspensionReason are only ever cleared by an admin action, so a
  // timed restriction/suspension can expire (suspendedUntil passes) while
  // those fields are still stuck from when it was created. Route everything
  // through isBorrowingRestrictionActive() first, since that's the function
  // that actually checks the suspendedUntil date - otherwise the badge stays
  // on "Temporarily Restricted"/"Borrowing Disabled" forever.
  if (!isBorrowingRestrictionActive(user)) {
    return isUserSuspended(user) ? "Suspended" : "Active";
  }

  if (isTemporaryBorrowingRestriction(user)) {
    return "Temporarily Restricted";
  }

  return "Borrowing Disabled";
}

function getBorrowingStatusClass(user) {
  const status = getBorrowingStatusLabel(user);

  return String(status || "active")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

  function getRoleLabel(userRole) {
    if (userRole === "superAdmin") return "Super Admin";
    if (userRole === "categoryAdmin") return "Category Admin";
    return "Borrower";
  }

  function getUserTypeLabel(user) {
    if (user.role !== "borrower") return "N/A";
    return user.userType || "Student";
  }

  function getIdNumberLabel(user) {
    if (user.role !== "borrower") return "N/A";

    if (user.userType === "Faculty" || user.userType === "Staff") {
      return user.employeeId || "Not set";
    }

    return user.studentNumber || "Not set";
  }

  function getYearSectionLabel(user) {
    if (user.role !== "borrower") return "N/A";

    const values = [user.yearLevel, user.section].filter(Boolean);

    if (values.length === 0) return "Not set";

    return values.join(" - ");
  }

  function getCategoryName(categoryId) {
    const category = categories.find(
      (item) => normalizeText(item.id) === normalizeText(categoryId)
    );

    return category?.name || categoryId || "Unknown";
  }

  function formatAssignedCategories(categoryIds) {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      return "None";
    }

    return categoryIds.map(getCategoryName).join(", ");
  }

  function getCategoryAssignmentUsers() {
    return categoryAdminAssignments.length > 0
      ? categoryAdminAssignments
      : users.filter((user) => user.role === "categoryAdmin");
  }

  function getCategoryAdminOwner(categoryId, excludeUserId = "") {
    if (!categoryId) return null;

    return (
      getCategoryAssignmentUsers().find((user) => {
        if (!user || user.id === excludeUserId) return false;
        if (user.role !== "categoryAdmin") return false;

        const userCategories = Array.isArray(user.assignedCategories)
          ? user.assignedCategories
          : [];

        return userCategories.some(
          (assignedCategoryId) =>
            normalizeText(assignedCategoryId) === normalizeText(categoryId)
        );
      }) || null
    );
  }

  function isCategoryAssignedToAnotherAdmin(categoryId, excludeUserId = "") {
    return Boolean(getCategoryAdminOwner(categoryId, excludeUserId));
  }

  function getCategoryAdminOwnerName(categoryId, excludeUserId = "") {
    const owner = getCategoryAdminOwner(categoryId, excludeUserId);

    return owner?.fullName || owner?.email || "another mini admin";
  }

  function getCategoryAlreadyAssignedMessage(categoryId, excludeUserId = "") {
    return `This category is already assigned to ${getCategoryAdminOwnerName(
      categoryId,
      excludeUserId
    )}. Choose another category.`;
  }

  function getAvailableCategoryCountForCategoryAdmin(excludeUserId = "") {
    return categories.filter(
      (category) => !isCategoryAssignedToAnotherAdmin(category.id, excludeUserId)
    ).length;
  }

  async function getCategoryAssignmentConflictFromServer(
    categoryId,
    excludeUserId = ""
  ) {
    if (!categoryId) return "";

    const usersRef = collection(db, "users");
    const categoryAdminSnapshot = await getDocs(
      firestoreQuery(usersRef, where("role", "==", "categoryAdmin"))
    );

    const ownerDocument = categoryAdminSnapshot.docs.find((document) => {
      if (document.id === excludeUserId) return false;

      const userData = document.data();
      const userCategories = Array.isArray(userData.assignedCategories)
        ? userData.assignedCategories
        : [];

      return userCategories.some(
        (assignedCategoryId) =>
          normalizeText(assignedCategoryId) === normalizeText(categoryId)
      );
    });

    if (!ownerDocument) return "";

    const owner = ownerDocument.data();
    const ownerName = owner?.fullName || owner?.email || "another mini admin";

    return `This category is already assigned to ${ownerName}. Choose another category.`;
  }

  function getBorrowerDetailsPayload(sourceRole = role) {
    if (sourceRole !== "borrower") {
      return {
        userType: "",
        studentNumber: "",
        employeeId: "",
        courseDepartment: "",
        yearLevel: "",
        section: "",
        mobileNumber: "",
      };
    }

    const safeUserType = getSafeUserType(userType);

    return {
      userType: safeUserType,
      studentNumber:
        safeUserType === "Student" ? cleanInput(studentNumber) : "",
      employeeId:
        safeUserType === "Faculty" || safeUserType === "Staff"
          ? cleanInput(employeeId)
          : "",
      courseDepartment: cleanInput(courseDepartment),
      yearLevel: safeUserType === "Student" ? cleanInput(yearLevel) : "",
      section: safeUserType === "Student" ? cleanInput(section) : "",
      mobileNumber: cleanInput(mobileNumber),
    };
  }

  function getEditBorrowerDetailsPayload(sourceRole = editRole) {
    if (sourceRole !== "borrower") {
      return {
        userType: "",
        studentNumber: "",
        employeeId: "",
        courseDepartment: "",
        yearLevel: "",
        section: "",
        mobileNumber: "",
      };
    }

    const safeUserType = getSafeUserType(editUserType);

    return {
      userType: safeUserType,
      studentNumber:
        safeUserType === "Student" ? cleanInput(editStudentNumber) : "",
      employeeId:
        safeUserType === "Faculty" || safeUserType === "Staff"
          ? cleanInput(editEmployeeId)
          : "",
      courseDepartment: cleanInput(editCourseDepartment),
      yearLevel: safeUserType === "Student" ? cleanInput(editYearLevel) : "",
      section: safeUserType === "Student" ? cleanInput(editSection) : "",
      mobileNumber: cleanInput(editMobileNumber),
    };
  }
  async function fetchAllUsersForSearch() {
  const usersRef = collection(db, "users");
  const usersSnapshot = await getDocs(usersRef);

  const userData = usersSnapshot.docs
    .map((document) => ({
      id: document.id,
      ...document.data(),
    }))
    .sort((a, b) =>
      String(a.email || "").localeCompare(String(b.email || ""))
    );

  setUsers(userData);
  setHasMoreUsers(false);
  setLastUserDoc(null);
}
async function handleUserSearchChange(event) {
  const value = event.target.value;

  setSearchTerm(value);
  showStatus("", "");

  if (!value.trim()) {
    try {
      await fetchUsersPage("reset", roleFilter);
    } catch (error) {
      showStatus("Error loading users: " + error.message, "error");
    }

    return;
  }

  try {
    await fetchAllUsersForSearch();
  } catch (error) {
    showStatus("Error searching users: " + error.message, "error");
  }
}

  async function fetchUserStats() {
  const usersRef = collection(db, "users");

  const [
    totalSnapshot,
    borrowersSnapshot,
    categoryAdminsSnapshot,
    superAdminsSnapshot,
    suspendedSnapshot,
  ] = await Promise.all([
    getCountFromServer(usersRef),
    getCountFromServer(
      firestoreQuery(usersRef, where("role", "==", "borrower"))
    ),
    getCountFromServer(
      firestoreQuery(usersRef, where("role", "==", "categoryAdmin"))
    ),
    getCountFromServer(
      firestoreQuery(usersRef, where("role", "==", "superAdmin"))
    ),
    getCountFromServer(
      firestoreQuery(usersRef, where("canBorrow", "==", false))
    ),
  ]);

  setUserStats({
    total: totalSnapshot.data().count || 0,
    borrowers: borrowersSnapshot.data().count || 0,
    categoryAdmins: categoryAdminsSnapshot.data().count || 0,
    superAdmins: superAdminsSnapshot.data().count || 0,
    suspended: suspendedSnapshot.data().count || 0,
  });
}

  async function fetchUsersPage(mode = "reset", selectedRole = roleFilter) {
    const usersRef = collection(db, "users");
    const isRoleFiltered = selectedRole !== "All";

    let userQuery;

    if (isRoleFiltered) {
      userQuery =
        mode === "more" && lastUserDoc
          ? firestoreQuery(
              usersRef,
              where("role", "==", selectedRole),
              startAfter(lastUserDoc),
              limit(USERS_PAGE_SIZE + 1)
            )
          : firestoreQuery(
              usersRef,
              where("role", "==", selectedRole),
              limit(USERS_PAGE_SIZE + 1)
            );
    } else {
      userQuery =
        mode === "more" && lastUserDoc
          ? firestoreQuery(
              usersRef,
              orderBy("email", "asc"),
              startAfter(lastUserDoc),
              limit(USERS_PAGE_SIZE + 1)
            )
          : firestoreQuery(
              usersRef,
              orderBy("email", "asc"),
              limit(USERS_PAGE_SIZE + 1)
            );
    }

    const usersSnapshot = await getDocs(userQuery);
    const docs = usersSnapshot.docs;
    const visibleDocs = docs.slice(0, USERS_PAGE_SIZE);

    const userData = visibleDocs.map((document) => ({
      id: document.id,
      ...document.data(),
    }));

    setHasMoreUsers(docs.length > USERS_PAGE_SIZE);
    setLastUserDoc(visibleDocs[visibleDocs.length - 1] || null);

    if (mode === "more") {
      setUsers((previousUsers) => {
        const existingIds = new Set(previousUsers.map((user) => user.id));
        const newUsers = userData.filter((user) => !existingIds.has(user.id));

        return [...previousUsers, ...newUsers];
      });

      return;
    }

    setUsers(userData);
  }

  async function handleLoadMoreUsers() {
    if (!hasMoreUsers || loadingMoreUsers) return;

    setLoadingMoreUsers(true);
    showStatus("", "");

    try {
      await fetchUsersPage("more", roleFilter);
    } catch (error) {
      showStatus("Error loading more users: " + error.message, "error");
    } finally {
      setLoadingMoreUsers(false);
    }
  }

    async function handleRoleFilterChange(event) {
    const selectedRole = event.target.value;

    setRoleFilter(selectedRole);
    setEditingUserId("");
    setUsers([]);
    setLastUserDoc(null);
    setHasMoreUsers(false);
    setLoadingMoreUsers(true);
    showStatus("", "");

    try {
      await fetchUsersPage("reset", selectedRole);
    } catch (error) {
      showStatus("Error loading selected role: " + error.message, "error");
    } finally {
      setLoadingMoreUsers(false);
    }
  }
  async function fetchData() {
    setLoading(true);

    try {
      const [
        categoriesSnapshot,
        itemsSnapshot,
        requestsSnapshot,
        penaltyRecordsSnapshot,
        categoryAdminsSnapshot,
      ] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "items")),
        getDocs(collection(db, "borrowRequests")),
        getDocs(collection(db, "penaltyRecords")),
        getDocs(
          firestoreQuery(
            collection(db, "users"),
            where("role", "==", "categoryAdmin")
          )
        ),
      ]);

      const categoryData = categoriesSnapshot.docs
        .map((document) => ({
          id: document.id,
          ...document.data(),
        }))
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );

      const itemData = itemsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const requestData = requestsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const penaltyRecordData = penaltyRecordsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      const categoryAdminData = categoryAdminsSnapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }));

      setCategories(categoryData);
      setItems(itemData);
      setBorrowRequests(requestData);
      setPenaltyRecords(penaltyRecordData);
      setCategoryAdminAssignments(categoryAdminData);

      await Promise.all([
        fetchUserStats(),
        fetchUsersPage("reset", roleFilter),
      ]);
    } catch (error) {
      showStatus("Error loading user management data: " + error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function handleCategoryToggle(categoryId) {
    if (isCategoryAssignedToAnotherAdmin(categoryId)) {
      const message = getCategoryAlreadyAssignedMessage(categoryId);

      setCreateFieldErrors((previousErrors) => ({
        ...previousErrors,
        assignedCategories: message,
      }));

      showBlockedAction(message);
      return;
    }

    setAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return [];
      }

      return [categoryId];
    });
  }

  function handleEditCategoryToggle(categoryId) {
    if (isCategoryAssignedToAnotherAdmin(categoryId, editingUserId)) {
      const message = getCategoryAlreadyAssignedMessage(
        categoryId,
        editingUserId
      );

      setEditFieldErrors((previousErrors) => ({
        ...previousErrors,
        editAssignedCategories: message,
      }));

      showBlockedAction(message);
      return;
    }

    setEditAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return [];
      }

      return [categoryId];
    });
  }

  function resetBorrowerDetails() {
    setUserType("Student");
    setStudentNumber("");
    setEmployeeId("");
    setCourseDepartment("");
    setYearLevel("");
    setSection("");
    setMobileNumber("");
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
    return "Full name is required.";
  }

  if (cleanedValue.length < 2) {
    return "Full name must be at least 2 characters.";
  }

  if (cleanedValue.length > 80) {
    return "Full name must not exceed 80 characters.";
  }

  if (!isValidPersonName(cleanedValue)) {
    return "Full name can only contain letters, spaces, dot, hyphen, and apostrophe.";
  }

  return "";
}
function sanitizePersonNameInput(value) {
  return String(value || "").replace(/[^\p{L}\s.'-]/gu, "");
}

// --- Edit User modal field sanitizers/validators ---
// These are intentionally separate from the Create User rules above so the
// stricter Edit User limits (name: 50 chars/letters+spaces only, student
// number: digits only, section: no symbols) don't change behavior anywhere
// else in the system.

function sanitizeEditFullNameInput(value) {
  return String(value || "")
    .replace(/[^\p{L}\s-]/gu, "")
    .slice(0, EDIT_FULL_NAME_MAX_LENGTH);
}

function getEditFullNameError(value) {
  const cleanedValue = String(value || "").trim();

  if (!cleanedValue) {
    return "Full name is required.";
  }

  if (cleanedValue.length > EDIT_FULL_NAME_MAX_LENGTH) {
    return `Full name must be ${EDIT_FULL_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!EDIT_FULL_NAME_ALLOWED_PATTERN.test(cleanedValue)) {
    return "Full name can only contain letters and spaces (no numbers or symbols).";
  }

  return "";
}

function sanitizeStudentNumberInput(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, STUDENT_NUMBER_MAX_LENGTH);
}

function getStudentNumberError(value) {
  const cleanedValue = String(value || "").trim();

  // Student number is optional - only validate format when something was entered.
  if (!cleanedValue) return "";

  if (!STUDENT_NUMBER_ALLOWED_PATTERN.test(cleanedValue)) {
    return "Student number can only contain numbers.";
  }

  if (cleanedValue.length > STUDENT_NUMBER_MAX_LENGTH) {
    return `Student number must be ${STUDENT_NUMBER_MAX_LENGTH} digits or fewer.`;
  }

  return "";
}

function sanitizeSectionInput(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .slice(0, SECTION_MAX_LENGTH);
}

function getSectionError(value) {
  const cleanedValue = String(value || "").trim();

  // Section is optional - only validate format when something was entered.
  if (!cleanedValue) return "";

  if (cleanedValue.length > SECTION_MAX_LENGTH) {
    return `Section must be ${SECTION_MAX_LENGTH} characters or fewer.`;
  }

  if (!SECTION_ALLOWED_PATTERN.test(cleanedValue)) {
    return "Section can only contain letters, numbers, and spaces (no symbols).";
  }

  return "";
}

function resetCreateForm() {
  setFullName("");
  setEmail("");
  setTemporaryPassword("");
  setShowTemporaryPassword(false);
  setRole("borrower");
  setAssignedCategories([]);
  setCreateFieldErrors({});
  setCreateTouched(false);
  resetBorrowerDetails();
}

async function handleCreateUser(e) {
  e.preventDefault();

  if (creating || createUserSubmitLockRef.current) {
    return;
  }

  createUserSubmitLockRef.current = true;
  setCreating(true);

  try {
    const isValid = validateCreateUserForm();

    if (!isValid) {
      return;
    }

    const duplicateError = await getCreateDuplicateError();

    if (duplicateError) {
      showToast(duplicateError, "error");
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim().toLowerCase(),
      temporaryPassword
    );

    const newUser = userCredential.user;

    await setDoc(doc(db, "users", newUser.uid), {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      role,
      assignedCategories:
        role === "categoryAdmin" ? assignedCategories.slice(0, 1) : [],
      ...getBorrowerDetailsPayload(role),
      overdueCount: 0,
      suspendedUntil: "",
      suspensionReason: "",
      canBorrow: true,
      isActive: true,
      termsAccepted: false,
      termsAcceptedAt: "",
      termsVersion: "1.0",
      mustChangePassword: true,
      passwordChangedAt: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await signOut(secondaryAuth);

    showToast("Successfully Created", "success");
    resetCreateForm();
    await fetchData();
  } catch (error) {
    if (error.code === "auth/email-already-in-use") {
      showToast(
        "This email is already registered. Please use a different email address.",
        "error"
      );

      setCreateFieldErrors((previousErrors) => ({
        ...previousErrors,
        email: "This email is already registered.",
      }));

      return;
    }

    const shortMessage = "Failed to create user";
    const detailedMessage = error?.message
      ? `${shortMessage}: ${error.message}`
      : shortMessage;

    showToast(detailedMessage, "error");
  } finally {
    createUserSubmitLockRef.current = false;
    setCreating(false);
  }
}

async function handleSeedCategories() {
  openConfirmAction({
    title: "Add Default Categories?",
    message: "Seed default categories: Sports, Laboratory, STEM, and IT?",
    confirmText: "Add Defaults",
    danger: false,
    onConfirm: async () => {
      setCategoryAction("seed");
      showStatus("", "");

      try {
        const seedDefaultCategories = httpsCallable(
          functions,
          "seedDefaultCategories"
        );

        await seedDefaultCategories();

        showToast("Default Categories Ready", "success");
        fetchData();
      } catch (error) {
        showActionError("Failed to add default categories", error);
      } finally {
        setCategoryAction("");
      }
    },
  });
}
async function handleAddCategory(event) {
  event.preventDefault();
  showStatus("", "");

  const isValid = validateAddCategoryForm();

 if (!isValid) {
  return;
}
  setCategoryAction("add");

    try {
      const addCategory = httpsCallable(functions, "addCategory");

      await addCategory({
        name: newCategoryName.trim(),
      });

      showToast("Successfully Created", "success");
      setNewCategoryName("");
      setCategoryTouched(false);
      fetchData();

    } catch (error) {
      const backendMessage = String(error?.message || "");
      const isDuplicateName =
        error?.code === "already-exists" ||
        /already exists/i.test(backendMessage) ||
        /duplicate/i.test(backendMessage);

      if (isDuplicateName) {
        // Specific, friendly toast only - no inline page banner for this case.
        showToast("You already have a category with this name.", "error");
        setCategoryFieldErrors({
          newCategoryName: "A category with this name already exists.",
        });
      } else {
        showActionError("Failed to add category", error);
      }
    } finally {
      setCategoryAction("");
    }
  }

async function handleDeleteCategory(category) {
  const usage = getCategoryUsage(category.id);

  if (!usage.canDelete) {
    showBlockedAction(
      "This category cannot be deleted because it is still used by items, admins, or active borrow requests."
    );
    return;
  }

  openConfirmAction({
    title: "Delete Category?",
    message: `Delete category "${category.name}"? This is allowed only because it has no items, admins, or active borrow requests.`,
    confirmText: "Delete Category",
    danger: true,
    onConfirm: async () => {
      setCategoryAction(category.id);
      showStatus("", "");

      try {
        const deleteCategory = httpsCallable(functions, "deleteCategory");

        await deleteCategory({
          categoryId: category.id,
        });

        showToast("Successfully Deleted", "success");
        fetchData();
      } catch (error) {
        showActionError("Failed to delete category", error);
      } finally {
        setCategoryAction("");
      }
    },
  });
}

  function startEditingUser(user) {
    setEditTouched(false);
    setEditFieldErrors({});
    setEditingUserId(user.id);
    setEditFullName(user.fullName || "");
    setEditEmail(user.email || "");
    setEditRole(user.role || "borrower");
    setEditAssignedCategories(
      Array.isArray(user.assignedCategories)
        ? user.assignedCategories.slice(0, 1)
        : []
    );

    setEditUserType(getSafeUserType(user.userType));
    setEditStudentNumber(user.studentNumber || "");
    setEditEmployeeId(user.employeeId || "");
    setEditCourseDepartment(user.courseDepartment || "");
    setEditYearLevel(user.yearLevel || "");
    setEditSection(user.section || "");
    setEditMobileNumber(user.mobileNumber || "");

    setEditNewPassword("");
    setEditConfirmPassword("");
    setShowEditNewPassword(false);
    setPasswordFieldErrors({});
  }

  function cancelEditingUser() {
    setEditFieldErrors({});
    setEditingUserId("");
    setEditFullName("");
    setEditEmail("");
    setEditRole("borrower");
    setEditAssignedCategories([]);

    setEditUserType("Student");
    setEditStudentNumber("");
    setEditEmployeeId("");
    setEditCourseDepartment("");
    setEditYearLevel("");
    setEditSection("");
    setEditMobileNumber("");
    setEditTouched(false);

    setEditNewPassword("");
    setEditConfirmPassword("");
    setShowEditNewPassword(false);
    setPasswordFieldErrors({});
  }

  function confirmDiscardEditChanges() {
  if (!editTouched) {
    cancelEditingUser();
    return;
  }

  openConfirmAction({
    title: "Discard Edit Changes?",
    message: "Discard unsaved edit user changes?",
    confirmText: "Discard Changes",
    danger: true,
    onConfirm: async () => {
      cancelEditingUser();
    },
  });
}

async function handleSaveUserChanges(user) {
  showStatus("", "");

  const isValid = validateEditUserForm();

if (!isValid) {
  return;
}

if (
  user.role === "borrower" &&
  (editRole === "categoryAdmin" || editRole === "superAdmin") &&
  getActiveBorrowRequestCountForUser(user.id) > 0
) {
  const blockedRoleMessage =
    "This borrower has an active borrow request and cannot be switched to an admin role until it is returned, rejected, or cancelled.";

  setEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    editRole: blockedRoleMessage,
  }));
  showToast(blockedRoleMessage, "error");
  return;
}

const emailConflict = await getEditDuplicateError(user.id);

if (emailConflict) {
  setEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    editEmail: emailConflict,
  }));
  showToast(emailConflict, "error");
  return;
}

if (editRole === "categoryAdmin") {
  const categoryConflict = await getCategoryAssignmentConflictFromServer(
    editAssignedCategories[0],
    user.id
  );

  if (categoryConflict) {
    setEditFieldErrors((previousErrors) => ({
      ...previousErrors,
      editAssignedCategories: categoryConflict,
    }));
    showStatus(categoryConflict, "error");
    return;
  }
}

setUpdatingId(user.id);

    try {
      const cleanedEditEmail = editEmail.trim().toLowerCase();
      const emailChanged = cleanedEditEmail !== (user.email || "").toLowerCase();

      // Email lives in both Firebase Auth (the actual login credential) and
      // the Firestore user doc. Writing it with a plain updateDoc would only
      // change what Firestore displays while the user keeps logging in with
      // their old email - so email changes go through a Cloud Function that
      // updates Auth first and only then mirrors it into Firestore.
      if (emailChanged) {
        const updateUserEmail = httpsCallable(functions, "updateUserEmail");

        await updateUserEmail({ uid: user.id, email: cleanedEditEmail });
      }

      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        fullName: editFullName.trim(),
        role: editRole,
        assignedCategories:
          editRole === "categoryAdmin"
            ? editAssignedCategories.slice(0, 1)
            : [],
        ...getEditBorrowerDetailsPayload(editRole),
        updatedAt: serverTimestamp(),
      });

      showToast("Successfully Updated", "success");
      setEditTouched(false);
      cancelEditingUser();
      fetchData();

    } catch (error) {
      showActionError("Failed to update user", error);
    } finally {
      setUpdatingId("");
    }
  }

function validateEditPasswordForm() {
  const errors = {};

  if (!editNewPassword) {
    errors.editNewPassword = "New password is required.";
  } else if (editNewPassword.length < 6) {
    errors.editNewPassword = "Password must be at least 6 characters.";
  }

  if (editNewPassword && editConfirmPassword !== editNewPassword) {
    errors.editConfirmPassword = "Passwords do not match.";
  }

  setPasswordFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

async function handleSetUserPassword(user) {
  if (!validateEditPasswordForm()) {
    return;
  }

  openConfirmAction({
    title: "Set New Password?",
    message: `Set a new password for ${user.fullName || user.email}? They will be asked to change it after logging in.`,
    confirmText: "Set Password",
    onConfirm: async () => {
      setSettingPasswordId(user.id);

      try {
        const updateUserPassword = httpsCallable(functions, "updateUserPassword");

        await updateUserPassword({ uid: user.id, password: editNewPassword });

        showToast("Password updated successfully", "success");
        setEditNewPassword("");
        setEditConfirmPassword("");
        setShowEditNewPassword(false);
        setPasswordFieldErrors({});
      } catch (error) {
        showActionError("Failed to update password", error);
      } finally {
        setSettingPasswordId("");
      }
    },
  });
}

async function handleToggleAccountStatus(user) {
  if (user.role === "superAdmin") {
    showBlockedAction("Super admin accounts cannot be disabled here.");
    return;
  }

  if (currentAdmin?.uid === user.id) {
    showBlockedAction("You cannot disable your own account.");
    return;
  }

  const currentlyActive = user.isActive !== false;
  const nextValue = !currentlyActive;

  openConfirmAction({
    title: nextValue ? "Enable Account?" : "Disable Account?",
    message: nextValue
      ? `Enable account access for ${user.fullName || user.email}?`
      : `Disable account access for ${user.fullName || user.email}? This user will be blocked from using the system.`,
    confirmText: nextValue ? "Enable Account" : "Disable Account",
    danger: !nextValue,
    onConfirm: async () => {
      setUpdatingId(user.id);
      showStatus("", "");

      try {
        const userRef = doc(db, "users", user.id);

        await updateDoc(userRef, {
          isActive: nextValue,
          updatedAt: serverTimestamp(),
        });

        showToast(nextValue ? "Account Enabled" : "Account Disabled", "success");

        fetchData();
      } catch (error) {
        showActionError("Failed to update account status", error);
      } finally {
        setUpdatingId("");
      }
    },
  });
}

async function handleToggleBorrowing(user) {
  // Use the same expiration-aware check as the status badge, not the raw
  // canBorrow flag - otherwise this button can show "Enable Borrow" right
  // next to an "Active" badge for a user whose timed restriction already
  // expired but whose canBorrow flag hasn't been cleared yet, and clicking
  // it would silently do the opposite of what the label says.
  const nextValue = isBorrowingRestrictionActive(user);

  openConfirmAction({
    title: nextValue ? "Enable Borrowing?" : "Disable Borrowing?",
    message: nextValue
      ? `Enable borrowing for ${user.fullName || user.email}?`
      : `Disable borrowing for ${user.fullName || user.email}?`,
    confirmText: nextValue ? "Enable Borrowing" : "Disable Borrowing",
    danger: !nextValue,
    onConfirm: async () => {
      setUpdatingId(user.id);
      showStatus("", "");

      try {
        const userRef = doc(db, "users", user.id);

        // Always clear any old suspension data here, in both directions.
        // This is a direct manual admin action (not a timed suspension), so
        // a leftover suspendedUntil/suspensionReason from a previous
        // restriction should never linger - if it's a past date and we
        // later set canBorrow back to false without clearing it, the
        // expiration check would wrongly treat the fresh disable as already
        // expired.
        const updatePayload = {
          canBorrow: nextValue,
          suspendedUntil: "",
          suspensionReason: "",
          updatedAt: serverTimestamp(),
        };

        await updateDoc(userRef, updatePayload);

        if (nextValue) {
          await resolveActivePenaltyRecordsForUser(
            user,
            "Borrowing access enabled by admin."
          );
        }

        setViewingUser((previousUser) =>
          previousUser?.id === user.id
            ? {
                ...previousUser,
                canBorrow: nextValue,
                suspendedUntil: "",
                suspensionReason: "",
              }
            : previousUser
        );

        showToast(
          nextValue ? "Borrowing Enabled" : "Borrowing Disabled",
          "success"
        );

        fetchData();
      } catch (error) {
        showActionError("Failed to update borrowing status", error);
      } finally {
        setUpdatingId("");
      }
    },
  });
}

async function handleRestoreBorrowingAccess(user) {
  openConfirmAction({
    title: "Restore Borrowing Access?",
    message: `Restore borrowing access for ${user.fullName || user.email}? This removes the temporary restriction without changing overdue count records.`,
    confirmText: "Restore Access",
    danger: false,
    onConfirm: async () => {
      setUpdatingId(user.id);
      showStatus("", "");

      try {
        const userRef = doc(db, "users", user.id);

        await updateDoc(userRef, {
          canBorrow: true,
          suspendedUntil: "",
          suspensionReason: "",
          updatedAt: serverTimestamp(),
        });

        await resolveActivePenaltyRecordsForUser(
          user,
          "Borrowing access manually restored by admin."
        );

        showToast("Borrowing Access Restored", "success");

        setViewingUser((previousUser) =>
          previousUser?.id === user.id
            ? {
                ...previousUser,
                canBorrow: true,
                suspendedUntil: "",
                suspensionReason: "",
              }
            : previousUser
        );

        fetchData();
      } catch (error) {
        showActionError("Failed to restore borrowing access", error);
      } finally {
        setUpdatingId("");
      }
    },
  });
}

async function handleResetSuspension(user) {
  openConfirmAction({
    title: "Reset Suspension?",
    message: `Reset suspension and overdue count for ${user.fullName || user.email}? This will allow the borrower to borrow again.`,
    confirmText: "Reset Suspension",
    danger: true,
    onConfirm: async () => {
      setUpdatingId(user.id);
      showStatus("", "");

      try {
        const userRef = doc(db, "users", user.id);

        await updateDoc(userRef, {
          overdueCount: 0,
          suspendedUntil: "",
          suspensionReason: "",
          canBorrow: true,
          updatedAt: serverTimestamp(),
        });

        await resolveActivePenaltyRecordsForUser(
          user,
          "Suspension and overdue count reset by admin."
        );

        showToast("Suspension Reset", "success");
        fetchData();
      } catch (error) {
        showActionError("Failed to reset suspension", error);
      } finally {
        setUpdatingId("");
      }
    },
  });
}

async function handleDeleteUser(user) {
  if (user.role === "superAdmin") {
    showBlockedAction("Super admin accounts cannot be deleted here.");
    return;
  }

  if (currentAdmin?.uid === user.id) {
    showBlockedAction("You cannot delete your own account.");
    return;
  }

  openConfirmAction({
    title: "Delete User Permanently?",
    message: `Permanently delete ${user.fullName || user.email}? This deletes the Firebase Auth account and Firestore user record.`,
    confirmText: "Delete User",
    danger: true,
    onConfirm: async () => {
      setUpdatingId(user.id);
      showStatus("", "");

      try {
        const deleteUserCompletely = httpsCallable(
          functions,
          "deleteUserCompletely"
        );

        await deleteUserCompletely({
          uid: user.id,
        });

        showToast("Successfully Deleted", "success");
        fetchData();
      } catch (error) {
        showActionError("Failed to delete user", error);
      } finally {
        setUpdatingId("");
      }
    },
  });
}

  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const nextCharacter = text[index + 1];

      if (character === '"' && insideQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (character === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }

      if (character === "," && !insideQuotes) {
        row.push(cell.trim());
        cell = "";
        continue;
      }

      if ((character === "\n" || character === "\r") && !insideQuotes) {
        if (character === "\r" && nextCharacter === "\n") {
          index += 1;
        }

        row.push(cell.trim());

        if (row.some((value) => value !== "")) {
          rows.push(row);
        }

        row = [];
        cell = "";
        continue;
      }

      cell += character;
    }

    row.push(cell.trim());

    if (row.some((value) => value !== "")) {
      rows.push(row);
    }

    return rows;
  }

  function findHeaderIndex(headers, possibleNames) {
    return headers.findIndex((header) => possibleNames.includes(header));
  }

  function getOptionalCsvValue(row, index) {
    if (index === -1) return "";
    return row[index] || "";
  }

  async function handleCsvChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    setCsvBorrowers([]);
    setImportResults([]);
    setCsvFileName("");
    

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      showStatus("Please upload a CSV file only.", "error");
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsvText(text);

      if (rows.length < 2) {
        showStatus("CSV must contain headers and at least one borrower.", "error");
        return;
      }

      const headers = rows[0].map((header) =>
        header.trim().toLowerCase().replace(/\s+/g, " ")
      );

      const nameIndex = findHeaderIndex(headers, [
        "name",
        "full name",
        "fullname",
      ]);

      const emailIndex = findHeaderIndex(headers, ["email", "email address"]);

      const passwordIndex = findHeaderIndex(headers, [
        "password",
        "temporary password",
        "temp password",
      ]);

      const userTypeIndex = findHeaderIndex(headers, [
        "user type",
        "borrower type",
        "type",
        "account type",
      ]);

      const studentNumberIndex = findHeaderIndex(headers, [
        "student number",
        "student no",
        "student no.",
        "student id",
        "student id number",
      ]);

      const employeeIdIndex = findHeaderIndex(headers, [
        "employee id",
        "employee number",
        "faculty id",
        "staff id",
      ]);

      const courseDepartmentIndex = findHeaderIndex(headers, [
        "course department",
        "course/department",
        "course or department",
        "course",
        "department",
      ]);

      const yearLevelIndex = findHeaderIndex(headers, [
        "year level",
        "year",
        "yearlevel",
      ]);

      const sectionIndex = findHeaderIndex(headers, [
        "section",
        "class section",
      ]);

      const mobileNumberIndex = findHeaderIndex(headers, [
        "mobile number",
        "mobile",
        "phone",
        "phone number",
        "contact",
        "contact number",
      ]);

      if (nameIndex === -1 || emailIndex === -1 || passwordIndex === -1) {
        showStatus(
          "CSV headers must include Name, Email, and Password.",
          "error"
        );
        return;
      }

      const borrowers = rows
        .slice(1)
        .map((row) => ({
          fullName: row[nameIndex] || "",
          email: row[emailIndex] || "",
          password: row[passwordIndex] || "",
          userType: getOptionalCsvValue(row, userTypeIndex),
          studentNumber: getOptionalCsvValue(row, studentNumberIndex),
          employeeId: getOptionalCsvValue(row, employeeIdIndex),
          courseDepartment: getOptionalCsvValue(row, courseDepartmentIndex),
          yearLevel: getOptionalCsvValue(row, yearLevelIndex),
          section: getOptionalCsvValue(row, sectionIndex),
          mobileNumber: getOptionalCsvValue(row, mobileNumberIndex),
        }))
        .filter(
          (borrower) =>
            borrower.fullName.trim() ||
            borrower.email.trim() ||
            borrower.password.trim()
        );

      if (borrowers.length === 0) {
        showStatus("No valid borrower rows found in the CSV.", "error");
        return;
      }

      if (borrowers.length > 100) {
        showStatus("You can import up to 100 borrowers per CSV.", "error");
        return;
      }

      setCsvFileName(file.name);
      setCsvBorrowers(borrowers);
      markCsvChanged();

      showStatus(
        `CSV loaded: ${borrowers.length} borrower${borrowers.length === 1 ? "" : "s"} ready for import.`,
        "success"
      );
    } catch (error) {
      showActionError("Failed to read CSV file", error);
    }
  }

  function clearCsvImport() {
    setCsvFileName("");
    setCsvBorrowers([]);
    setImportResults([]);
    setCsvTouched(false);
  }
 function downloadBorrowerSampleCsv() {
  const csvRows = [
    [
      "Name",
      "Email",
      "Password",
      "User Type",
      "Student Number",
      "Employee ID",
      "Course Department",
      "Year Level",
      "Section",
      "Mobile Number",
    ],
    [
      "Juan Dela Cruz",
      "juan.delacruz@example.com",
      "TempPass123",
      "Student",
      "2026-0001",
      "",
      "BSCS",
      "1st Year",
      "A",
      "09123456789",
    ],
    [
      "Maria Santos",
      "maria.santos@example.com",
      "TempPass123",
      "Faculty",
      "",
      "EMP-001",
      "Computer Science",
      "",
      "",
      "09987654321",
    ],
    [
      "Pedro Reyes",
      "pedro.reyes@example.com",
      "TempPass123",
      "Staff",
      "",
      "EMP-002",
      "Library",
      "",
      "",
      "09112223344",
    ],
  ];

  const csvText = csvRows
    .map((row) =>
      row
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "qborrow-borrowers-sample.csv";
  link.click();

  URL.revokeObjectURL(url);
}

async function handleBulkImportBorrowers() {
  showStatus("", "");

  const isValid = validateCsvImportForm();

if (!isValid) {
  return;
}

openConfirmAction({
  title: "Import Borrower Accounts?",
  message: `Import ${csvBorrowers.length} borrower account${
    csvBorrowers.length === 1 ? "" : "s"
  }?`,
  confirmText: "Import CSV",
  danger: false,
  onConfirm: async () => {
    setImportingCsv(true);
    showStatus("", "");

    try {
      const bulkCreateBorrowers = httpsCallable(
        functions,
        "bulkCreateBorrowers"
      );

      const response = await bulkCreateBorrowers({
        borrowers: csvBorrowers,
      });

      const resultData = response.data || {};
      const created = resultData.created || 0;
      const failed = resultData.failed || 0;
      const results = Array.isArray(resultData.results)
        ? resultData.results
        : [];

      setImportResults(results);
      setCsvTouched(false);

showStatus(
  `CSV import finished. Created: ${created}. Failed: ${failed}.`,
  failed > 0 ? "error" : "success"
);

if (created > 0 && failed === 0) {
  showToast("CSV Import Successful", "success");
} else if (created > 0 && failed > 0) {
  showToast("CSV Import Completed With Some Errors", "error");
} else {
  showToast("CSV Import Failed", "error");
}

fetchData();
    } catch (error) {
      showActionError("Failed to import borrowers", error);
    } finally {
      setImportingCsv(false);
    }
  },
});
  }

  function getCategoryUsage(categoryId) {
    const normalizedCategoryId = normalizeText(categoryId);

    const itemCount = items.filter((item) => {
      const itemCategory = normalizeText(item.categoryId || item.category);
      return itemCategory === normalizedCategoryId;
    }).length;

    const adminCount = getCategoryAssignmentUsers().filter((user) => {
      const assigned = Array.isArray(user.assignedCategories)
        ? user.assignedCategories.map(normalizeText)
        : [];

      return (
        user.role === "categoryAdmin" &&
        assigned.includes(normalizedCategoryId)
      );
    }).length;

    const requestCount = borrowRequests.filter((request) => {
      const requestCategory = normalizeText(
        request.categoryId || request.category
      );

      return requestCategory === normalizedCategoryId;
    }).length;

    const activeRequestCount = borrowRequests.filter((request) => {
      const requestCategory = normalizeText(
        request.categoryId || request.category
      );

      return (
        requestCategory === normalizedCategoryId &&
        ACTIVE_REQUEST_STATUSES.includes(request.approvalStatus)
      );
    }).length;

    return {
      itemCount,
      adminCount,
      requestCount,
      activeRequestCount,
      canDelete: itemCount === 0 && adminCount === 0,
      canEditName: activeRequestCount === 0,
    };
  }

useEffect(() => {
  fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
  const hasUserManagementChanges =
    createTouched || categoryTouched || csvTouched || editTouched;

  setUnsavedChanges?.(
    hasUserManagementChanges &&
      !creating &&
      !categoryAction &&
      !importingCsv &&
      !updatingId,
    "You have unsaved user management changes. Leaving this page will discard your progress."
  );

  return () => {
    setUnsavedChanges?.(false);
  };
}, [
  createTouched,
  categoryTouched,
  csvTouched,
  editTouched,
  creating,
  categoryAction,
  importingCsv,
  updatingId,
  setUnsavedChanges,
]);

useEffect(() => {
  const selectedTool = searchParams.get("tool");
  const validTools = ["create", "categories", "import"];

  if (!selectedTool) {
    setActiveUserTool("");
    return;
  }

  if (!validTools.includes(selectedTool)) {
    return;
  }

  if (selectedTool === "categories") {
    setShowCategoryList(true);
  }

  setActiveUserTool(selectedTool);
}, [searchParams]);

  const editingUser = users.find((user) => user.id === editingUserId) || null;
  const isToolPage = Boolean(activeUserTool);

  const filteredUsers = users.filter((user) => {
    const searchableText = `
      ${user.fullName || ""}
      ${user.email || ""}
      ${user.role || ""}
      ${user.userType || ""}
      ${user.studentNumber || ""}
      ${user.employeeId || ""}
      ${user.courseDepartment || ""}
      ${user.yearLevel || ""}
      ${user.section || ""}
      ${user.mobileNumber || ""}
      ${formatAssignedCategories(user.assignedCategories)}
      ${user.suspensionReason || ""}
    `.toLowerCase();

    const matchesSearch = searchableText.includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "All" || user.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="user-management-loading">
        <div className="user-management-loading-card">
          <img src="/qborrow-logo.png" alt="QBorrow Logo" />
          <h2>Loading users...</h2>
          <p>Checking QBorrow account records.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="user-management-page">
      <ConfirmActionModal
  open={Boolean(confirmAction)}
  title={confirmAction?.title}
  message={confirmAction?.message}
  confirmText={confirmAction?.confirmText}
  cancelText={confirmAction?.cancelText || "Cancel"}
  danger={confirmAction?.danger}
  loading={confirmActionLoading}
  onConfirm={runConfirmAction}
  onCancel={closeConfirmAction}
/>
      {showToolCloseConfirm && (
  <div
    className="user-unsaved-confirm-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="user-unsaved-confirm-title"
    onClick={cancelCloseUserToolModal}
  >
    <section
      className="user-unsaved-confirm-card"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="user-unsaved-confirm-icon">!</div>

      <div className="user-unsaved-confirm-pill">Unsaved Changes</div>

      <h2 id="user-unsaved-confirm-title">
        You have unsaved changes.
      </h2>

      <p>
        Closing this window will discard your progress.
      </p>

      <div className="user-unsaved-confirm-actions">
        <button
          type="button"
          className="user-unsaved-confirm-cancel"
          onClick={cancelCloseUserToolModal}
        >
          No, Stay Here
        </button>

        <button
          type="button"
          className="user-unsaved-confirm-yes"
          onClick={confirmCloseUserToolModal}
        >
          Yes, Close Window
        </button>
      </div>
    </section>
  </div>
)}
{!isToolPage && (
<section className="user-management-header user-management-header-compact">
  <div className="user-management-header-content">
<div className="user-management-header-text">
  <h1>User Management</h1>

  <p>
    Manage QBorrow accounts, borrower imports, item categories, and category
    admin permissions from one Super Admin workspace.
  </p>
</div>

    <button
      type="button"
      className="user-secondary-btn user-management-header-back-btn"
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
)}

      {statusMessage && (
        <div
          className={`user-management-status user-management-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

{!isToolPage && (
      <section className="user-summary-grid">
        <div>
          <span>Σ</span>
          <h3>{userStats.total}</h3>
          <p>Total Users</p>
        </div>

        <div>
          <span>B</span>
          <h3>{userStats.borrowers}</h3>
          <p>Borrowers</p>
        </div>

        <div>
          <span>C</span>
          <h3>{userStats.categoryAdmins}</h3>
          <p>Category Admins</p>
        </div>

        <div>
          <span>S</span>
          <h3>{userStats.superAdmins}</h3>
          <p>Super Admins</p>
        </div>

        <div>
          <span>!</span>
          <h3>{userStats.suspended}</h3>
          <p>Suspended</p>
        </div>
      </section>
      )}

<section className="user-management-layout">
  <div className="user-left-stack">
          <section
  className={`user-create-card user-tool-modal-card ${
    activeUserTool === "create" ? "user-tool-active" : ""
  }`}
>
<button
  type="button"
  className="user-modal-close-btn"
  onClick={goToUserManagementHome}
>
  Back to User Management
</button>

<div className="user-modal-hero">
  <div className="user-modal-hero-text">
    <h2>Create User</h2>
    <p>
      Use a temporary password. Borrower details are optional but
      recommended for students, faculty, and staff.
    </p>
  </div>

  <button
    type="button"
    className="user-secondary-btn user-tool-dashboard-btn"
    onClick={goToDashboard}
  >
    Back to Dashboard
  </button>
</div>

            <form onSubmit={handleCreateUser} onChange={markCreateChanged} noValidate>
<div className="user-field">
  <label className="qb-label" htmlFor="full-name">
    Full Name <span className="required-star">*</span>
  </label>

  <input
    id="full-name"
    type="text"
    className={createFieldErrors.fullName ? "input-error" : ""}
    placeholder="Example: Juan Dela Cruz"
    value={fullName}
    onFocus={() => clearCreateFieldError("fullName")}
    onBlur={() => validateCreateField("fullName")}
onChange={(e) => {
  const sanitizedName = sanitizePersonNameInput(e.target.value);

  setFullName(sanitizedName);
  clearCreateFieldError("fullName");

  if (sanitizedName !== e.target.value) {
    setCreateFieldErrors((previousErrors) => ({
      ...previousErrors,
      fullName:
        "Full name can only contain letters, spaces, dot, hyphen, and apostrophe.",
    }));
  }
}}
    disabled={creating}
  />

  {createFieldErrors.fullName && (
    <p className="field-error-message">{createFieldErrors.fullName}</p>
  )}
</div>

<div className="user-field">
  <label className="qb-label" htmlFor="email">
    Email <span className="required-star">*</span>
  </label>

  <input
    id="email"
    type="email"
    className={createFieldErrors.email ? "input-error" : ""}
    placeholder="example@email.com"
    value={email}
    onFocus={() => clearCreateFieldError("email")}
    onBlur={() => validateCreateField("email")}
    onChange={(e) => {
      setEmail(e.target.value);
      clearCreateFieldError("email");
    }}
    disabled={creating}
  />

  {createFieldErrors.email && (
    <p className="field-error-message">{createFieldErrors.email}</p>
  )}
</div>

<div className="user-field">
  <label className="qb-label" htmlFor="temporary-password">
    Temporary Password <span className="required-star">*</span>
  </label>

  <div className="user-password-field-wrapper">
    <input
      id="temporary-password"
      type={showTemporaryPassword ? "text" : "password"}
      className={createFieldErrors.temporaryPassword ? "input-error" : ""}
      placeholder="At least 6 characters"
      value={temporaryPassword}
      onFocus={() => clearCreateFieldError("temporaryPassword")}
      onBlur={() => validateCreateField("temporaryPassword")}
      onChange={(e) => {
        setTemporaryPassword(e.target.value);
        clearCreateFieldError("temporaryPassword");
      }}
      disabled={creating}
    />

    <button
      type="button"
      className="user-password-toggle-btn"
      onClick={() => setShowTemporaryPassword((previous) => !previous)}
      aria-label={
        showTemporaryPassword ? "Hide temporary password" : "Show temporary password"
      }
      aria-pressed={showTemporaryPassword}
      tabIndex={-1}
    >
      {showTemporaryPassword ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 4 10 7-.4 1.15-1.13 2.34-2.12 3.42M6.53 6.53C4.4 8 2.9 9.94 2 12c1 3 5 7 10 7 1.28 0 2.5-.24 3.62-.68"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )}
    </button>
  </div>

  {createFieldErrors.temporaryPassword && (
    <p className="field-error-message">
      {createFieldErrors.temporaryPassword}
    </p>
  )}
</div>

<div className="user-field">
  <label className="qb-label" htmlFor="role">
    Role <span className="required-star">*</span>
  </label>

  <select
    id="role"
    className={createFieldErrors.role ? "input-error" : ""}
    value={role}
    onFocus={() => clearCreateFieldError("role")}
    onBlur={() => validateCreateField("role")}
    onChange={(e) => {
      setRole(e.target.value);
      clearCreateFieldError("role");
      clearCreateFieldError("assignedCategories");

      if (e.target.value !== "categoryAdmin") {
        setAssignedCategories([]);
      }

      if (e.target.value !== "borrower") {
        resetBorrowerDetails();
      }
    }}
    disabled={creating}
  >
    <option value="borrower">Borrower</option>
    <option value="categoryAdmin">Category Admin / Mini Admin</option>
    <option value="superAdmin">Super Admin</option>
  </select>

  {createFieldErrors.role && (
    <p className="field-error-message">{createFieldErrors.role}</p>
  )}
</div>

              {role === "borrower" && (
                <div className="user-borrower-details-box">
                  <span>Borrower Details</span>

                  <div className="user-borrower-details-grid">
                    <div className="user-field">
                      <label className="qb-label" htmlFor="user-type">
                        User Type
                      </label>

                      <select
                        id="user-type"
                        value={userType}
                        onChange={(e) => {
                          setUserType(e.target.value);
                          setStudentNumber("");
                          setEmployeeId("");
                          setYearLevel("");
                          setSection("");
                        }}
                      >
                        {USER_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>

                    {userType === "Student" ? (
                      <div className="user-field">
                        <label className="qb-label" htmlFor="student-number">
                          Student Number
                        </label>

                        <input
                          id="student-number"
                          type="text"
                          placeholder="Example: 2023-00125"
                          value={studentNumber}
                          onChange={(e) => setStudentNumber(e.target.value)}
                        />
                      </div>
                    ) : (
                      <div className="user-field">
                        <label className="qb-label" htmlFor="employee-id">
                          Employee ID
                        </label>

                        <input
                          id="employee-id"
                          type="text"
                          placeholder="Example: EMP-00015"
                          value={employeeId}
                          onChange={(e) => setEmployeeId(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="user-field">
                      <label className="qb-label" htmlFor="course-department">
                        Course / Department
                      </label>

                      <input
                        id="course-department"
                        type="text"
                        placeholder="Example: BSCS / Computer Studies"
                        value={courseDepartment}
                        onChange={(e) => setCourseDepartment(e.target.value)}
                      />
                    </div>

                    {userType === "Student" && (
                      <>
                        <div className="user-field">
                          <label className="qb-label" htmlFor="year-level">
                            Year Level
                          </label>

                          <select
                            id="year-level"
                            value={yearLevel}
                            onChange={(e) => setYearLevel(e.target.value)}
                          >
                            <option value="">Select Year Level</option>
                            {YEAR_LEVELS.map((year) => (
                              <option key={year} value={year}>
                                {year}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="user-field">
                          <label className="qb-label" htmlFor="section">
                            Section
                          </label>

                          <input
                            id="section"
                            type="text"
                            placeholder="Example: BSCS 3A"
                            value={section}
                            onChange={(e) => setSection(e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    <div className="user-field">
                      <label className="qb-label" htmlFor="mobile-number">
                        Mobile Number
                      </label>

                      <input
                        id="mobile-number"
                        type="text"
                        placeholder="Example: 09XXXXXXXXX"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}

              {role === "categoryAdmin" && (
                <div
  className="user-category-box"
  onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      validateCreateField("assignedCategories");
    }
  }}
>
                  <span>
  Assigned Category <span className="required-star">*</span>
</span>
<p className="user-small-note user-category-assignment-note">
  Select only one available category. Categories already assigned to another mini admin are locked.
</p>

                  {categories.length === 0 ? (
                    <p className="user-small-note">
                      No categories yet. Seed defaults or add a category first.
                    </p>
                  ) : (
                    <div className="user-category-grid">
                      {categories.map((category) => {
                        const assignedOwner = getCategoryAdminOwner(category.id);
                        const isAssignedToOtherAdmin = Boolean(assignedOwner);
                        const isSelected = assignedCategories.includes(
                          category.id
                        );

                        return (
                          <label
                            key={category.id}
                            className={`user-category-option ${
                              isSelected ? "user-category-option-selected" : ""
                            } ${
                              isAssignedToOtherAdmin
                                ? "user-category-option-disabled"
                                : ""
                            }`}
                            title={
                              isAssignedToOtherAdmin
                                ? getCategoryAlreadyAssignedMessage(category.id)
                                : "Available category"
                            }
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
  handleCategoryToggle(category.id);
  clearCreateFieldError("assignedCategories");
}}
                              disabled={creating || isAssignedToOtherAdmin}
                            />
                            <span className="user-category-option-text">
                              <strong>{category.name}</strong>
                              {isAssignedToOtherAdmin && (
                                <small>
                                  Assigned to{" "}
                                  {assignedOwner.fullName ||
                                    assignedOwner.email ||
                                    "another mini admin"}
                                </small>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {createFieldErrors.assignedCategories && (
  <p className="field-error-message">
    {createFieldErrors.assignedCategories}
  </p>
)}
                </div>
              )}

              <button
                type="submit"
                className="user-primary-btn user-create-submit-btn"
                disabled={creating}
                aria-disabled={creating}
                aria-busy={creating}
              >
                {creating ? "Creating..." : "Create User"}
              </button>
            </form>
          </section>

<section
  className={`user-admin-card user-tool-modal-card ${
    activeUserTool === "categories" ? "user-tool-active" : ""
  }`}
>

<div className="user-modal-hero">
  <div className="user-modal-hero-text">
    <h2>Manage Item Categories</h2>
    <p>
      Categories organize inventory items and define what category admins are
      allowed to manage. Delete is allowed only when a category is unused.
    </p>
  </div>
    <button
    type="button"
    className="user-secondary-btn user-tool-dashboard-btn"
    onClick={goToDashboard}
  >
    Back to Dashboard
  </button>
</div>

{categories.length === 0 && (
  <button
    type="button"
    className="user-secondary-btn user-full-btn"
    onClick={handleSeedCategories}
    disabled={categoryAction === "seed"}
  >
    {categoryAction === "seed"
      ? "Adding Defaults..."
      : "Add Default Categories"}
  </button>
)}

            <form
  className="user-category-add-form"
  onSubmit={handleAddCategory}
  onChange={markCategoryChanged}
  noValidate
>
<div className="user-field">
  <label className="qb-label" htmlFor="new-category">
    New Category <span className="required-star">*</span>
  </label>

  <input
    id="new-category"
    type="text"
    className={categoryFieldErrors.newCategoryName ? "input-error" : ""}
    placeholder="Example: Audio Visual Items"
    value={newCategoryName}
    maxLength={CATEGORY_NAME_MAX_LENGTH}
    onFocus={() => clearCategoryFieldError("newCategoryName")}
    onBlur={() => validateCategoryField("newCategoryName")}
    onChange={(event) => {
      setNewCategoryName(event.target.value);
      clearCategoryFieldError("newCategoryName");
    }}
    disabled={categoryAction === "add"}
  />

  <p className="user-small-note user-category-char-count">
    {newCategoryName.trim().length}/{CATEGORY_NAME_MAX_LENGTH} characters
  </p>

  {categoryFieldErrors.newCategoryName && (
    <p className="field-error-message">
      {categoryFieldErrors.newCategoryName}
    </p>
  )}
</div>

              <button
                type="submit"
                className="user-primary-btn"
                disabled={categoryAction === "add"}
              >
                {categoryAction === "add" ? "Adding..." : "Add Category"}
              </button>
            </form>

            <div className="user-category-toggle-row">
              <button
                type="button"
                className="user-secondary-btn user-category-toggle-btn"
                onClick={() => setShowCategoryList((current) => !current)}
              >
                {showCategoryList
                  ? "Hide Categories"
                  : `View Categories (${categories.length})`}
                <span>{showCategoryList ? "▲" : "▼"}</span>
              </button>
            </div>

{showCategoryList && (
  <div className="user-category-table-wrap">
    {categories.length === 0 ? (
      <div className="user-category-empty">No categories yet.</div>
    ) : (
      <table className="user-category-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Items</th>
            <th>Admins</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {categories.map((category) => {
            const usage = getCategoryUsage(category.id);

            return (
              <tr key={category.id}>
                <td>
                  <strong>{category.name}</strong>
                  <span>{category.id}</span>
                </td>

                <td>{usage.itemCount}</td>
                <td>{usage.adminCount}</td>

                <td>
                  <span
                    className={
                      usage.canDelete
                        ? "user-category-status deletable"
                        : "user-category-status locked"
                    }
                  >
                    {usage.canDelete ? "Unused" : "In Use"}
                  </span>
                </td>

                <td>
                  <div className="user-category-action-cell">
                    <button
                      type="button"
                      className={
                        usage.canEditName
                          ? "user-edit-category-btn"
                          : "user-edit-category-btn user-edit-category-locked"
                      }
                      onClick={() =>
                        usage.canEditName && startEditingCategory(category)
                      }
                      disabled={!usage.canEditName || Boolean(categoryAction)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className={
                        usage.canDelete
                          ? "user-danger-btn"
                          : "user-secondary-btn"
                      }
                      onClick={() => handleDeleteCategory(category)}
                      disabled={
                        !usage.canDelete ||
                        categoryAction === category.id
                      }
                    >
                      {categoryAction === category.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </div>
)}

{editingCategory && (
  <div
    className="user-view-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Edit category name"
  >
    <section className="user-edit-modal user-edit-category-modal">
      <button
        type="button"
        className="user-modal-close-btn user-modal-close-x"
        onClick={cancelEditingCategory}
        disabled={savingCategoryEdit}
        aria-label="Close edit category"
      >
        ×
      </button>

      <div className="user-section-heading">
        <h2>Edit Category Name</h2>
        <p>Rename this category. Item counts, admins, and requests stay the same.</p>
      </div>

      <form onSubmit={handleUpdateCategoryName} noValidate>
        <div className="user-field">
          <label className="qb-label" htmlFor="edit-category-name">
            Category Name <span className="required-star">*</span>
          </label>

          <input
            id="edit-category-name"
            type="text"
            className={
              categoryEditFieldErrors.editCategoryName ? "input-error" : ""
            }
            value={editCategoryName}
            maxLength={CATEGORY_NAME_MAX_LENGTH}
            onFocus={() => clearCategoryEditFieldError("editCategoryName")}
            onBlur={validateCategoryEditField}
            onChange={(event) => {
              setEditCategoryName(event.target.value);
              clearCategoryEditFieldError("editCategoryName");
            }}
            disabled={savingCategoryEdit}
            autoFocus
          />

          <p className="user-small-note user-category-char-count">
            {editCategoryName.trim().length}/{CATEGORY_NAME_MAX_LENGTH} characters
          </p>

          {categoryEditFieldErrors.editCategoryName && (
            <p className="field-error-message">
              {categoryEditFieldErrors.editCategoryName}
            </p>
          )}
        </div>

        <div className="user-view-actions user-edit-modal-actions">
          <button
            type="button"
            className="user-secondary-btn"
            onClick={cancelEditingCategory}
            disabled={savingCategoryEdit}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="user-primary-btn"
            disabled={savingCategoryEdit}
          >
            {savingCategoryEdit ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </section>
  </div>
)}
          </section>

<section
  className={`user-admin-card user-tool-modal-card ${
    activeUserTool === "import" ? "user-tool-active" : ""
  }`}
>
  <button
    type="button"
    className="user-modal-close-btn"
    onClick={closeUserToolModal}
    aria-label="Close Import Borrowers modal"
  >
    Close
  </button>

<div className="user-modal-hero">
  <div className="user-modal-hero-text">
    <h2>Import Borrowers</h2>
    <p>
      Required CSV headers: Name, Email, Password. Optional headers:
      User Type, Student Number, Employee ID, Course Department, Year
      Level, Section, Mobile Number.
    </p>
  </div>
    <button
    type="button"
    className="user-secondary-btn user-tool-dashboard-btn"
    onClick={goToDashboard}
  >
    Back to Dashboard
  </button>
</div>
        <div className="user-import-polish-grid">
    <div className="user-import-guide-card">
      <div className="user-import-guide-icon">1</div>

      <div>
        <strong>Download the sample CSV</strong>
        <p>
          Use the provided file so the column headers stay correct and aligned.
        </p>
      </div>

      <button
        type="button"
        className="user-secondary-btn"
        onClick={downloadBorrowerSampleCsv}
      >
        Download Sample CSV
      </button>
    </div>

    <div className="user-import-guide-card">
      <div className="user-import-guide-icon">2</div>

      <div>
        <strong>Fill in borrower accounts</strong>
        <p>
          Name, Email, and Password are required. Other fields are optional but
          recommended for student, faculty, and staff records.
        </p>
      </div>
    </div>

    <div className="user-import-guide-card">
      <div className="user-import-guide-icon">3</div>

      <div>
        <strong>Upload and import</strong>
        <p>
          Upload the completed CSV file, review the loaded row count, then click
          Import CSV.
        </p>
      </div>
    </div>
  </div>

  <div className="user-csv-format-panel">
    <div>
      <strong>Column Headers</strong>
      <p>Do not rename, remove, or rearrange these headers.</p>
    </div>

    <div className="user-csv-header-grid">
      {[
        "Name",
        "Email",
        "Password",
        "User Type",
        "Student Number",
        "Employee ID",
        "Course Department",
        "Year Level",
        "Section",
        "Mobile Number",
      ].map((header) => (
        <span key={header}>{header}</span>
      ))}
    </div>

    <div className="user-import-notes">
      <strong>Important Notes</strong>

      <ul>
        <li>Required columns: Name, Email, Password.</li>
        <li>User Type can be Student, Faculty, or Staff.</li>
        <li>Student Number is for students only.</li>
        <li>Employee ID is for faculty and staff.</li>
        <li>Maximum import limit is 100 borrowers per CSV.</li>
      </ul>
    </div>
  </div>

  <div className="user-upload-panel">
    <div className="user-upload-panel-heading">
      <div>
        <strong>Upload Borrower CSV</strong>
        <p>Select the completed CSV file from your computer.</p>
      </div>

      {csvFileName && (
        <span>{csvBorrowers.length} row{csvBorrowers.length === 1 ? "" : "s"}</span>
      )}
    </div>

    <div className="user-field">
      <label className="qb-label" htmlFor="borrower-csv">
        Borrower CSV <span className="required-star">*</span>
      </label>

      <input
        id="borrower-csv"
        type="file"
        className={csvFieldErrors.borrowerCsv ? "input-error" : ""}
        accept=".csv,text/csv"
        onFocus={() => clearCsvFieldError("borrowerCsv")}
        onBlur={() => validateCsvField("borrowerCsv")}
        onChange={(event) => {
          clearCsvFieldError("borrowerCsv");
          handleCsvChange(event);
        }}
        disabled={importingCsv}
      />

      {csvFieldErrors.borrowerCsv && (
        <p className="field-error-message">{csvFieldErrors.borrowerCsv}</p>
      )}
    </div>

    {csvFileName && (
      <div className="user-csv-preview">
        <strong>{csvFileName}</strong>
        <span>{csvBorrowers.length} borrower rows ready for import</span>
      </div>
    )}

    <div className="user-csv-actions">
      <button
        type="button"
        className="user-primary-btn"
        onClick={handleBulkImportBorrowers}
        disabled={importingCsv || csvBorrowers.length === 0}
      >
        {importingCsv ? "Importing..." : "Import CSV"}
      </button>

      <button
        type="button"
        className="user-secondary-btn"
        onClick={clearCsvImport}
        disabled={importingCsv}
      >
        Clear
      </button>
    </div>
  </div>

  {importResults.length > 0 && (
    <div className="user-import-results">
      {importResults.slice(0, 8).map((result, index) => (
        <div
          key={`${result.email}-${index}`}
          className={result.success ? "success" : "failed"}
        >
          <strong>{result.email || "No email"}</strong>
          <span>{result.message}</span>
        </div>
      ))}

      {importResults.length > 8 && <p>Showing first 8 results only.</p>}
    </div>
  )}
          </section>
        </div>

        <section className="user-list-card">
          <div className="user-section-heading">
            <h2>Existing Users</h2>

            <p>
Showing {filteredUsers.length} of {users.length} loaded account
{users.length === 1 ? "" : "s"}.
{searchTerm.trim()
  ? " Search checks all loaded matching users."
  : hasMoreUsers
  ? " Load more to view additional users."
  : ""}
            </p>
          </div>

          <div className="user-tools">
            <div>
              <label className="qb-label" htmlFor="user-search">
                Search Users
              </label>

<input
  id="user-search"
  type="text"
  placeholder="Search name, email, role, ID, course, section..."
  value={searchTerm}
  onChange={handleUserSearchChange}
/>
            </div>

            <div>
              <label className="qb-label" htmlFor="user-role-filter">
                Role
              </label>

                <select
                  id="user-role-filter"
                  value={roleFilter}
                  onChange={handleRoleFilterChange}
                  disabled={loadingMoreUsers}
                >
                <option value="All">All Roles</option>
                <option value="borrower">Borrower</option>
                <option value="categoryAdmin">Category Admin</option>
                <option value="superAdmin">Super Admin</option>
              </select>
            </div>

            <button
              type="button"
              className="user-refresh-btn"
              onClick={fetchData}
            >
              Refresh
            </button>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="user-empty">
              <img src="/qborrow-logo.png" alt="QBorrow Logo" />
              <h2>No users found</h2>
              <p>Try changing your search or role filter.</p>
            </div>
          ) : (
            <>
              <div
                id="user-table-scroll-area-final"
                className="user-table-scroll-area"
              >
                <div
                  id="user-table-wide-inner-final"
                  className="user-table-wide-inner"
                >
             <div className="user-table-header">
  <span>Name</span>
  <span>Email / Role</span>
  <span>Contact</span>
  <span>Category</span>
  <span>Created</span>
  <span>Status</span>
  <span>Actions</span>
</div>

<div className="user-grid user-table-grid">
                {filteredUsers.map((user) => {
                  const isEditing = editingUserId === user.id;

                  return (
                    <article
  className={`user-card ${isEditing ? "user-card-editing" : ""}`}
  key={user.id}
>
                      <div className="user-card-topline">
                        <span>{user.email}</span>

                        <strong className={`role-${user.role || "borrower"}`}>
                          {getRoleLabel(user.role)}
                        </strong>
                      </div>

<h3>{user.fullName || "No name"}</h3>

<div className="user-table-cells">
  <div className="user-table-cell user-table-contact">
    <span>Contact</span>
    <strong>
      {user.role === "borrower" ? user.mobileNumber || "-" : "-"}
    </strong>
  </div>

  <div className="user-table-cell user-table-category">
    <span>Category</span>
    <strong>{formatAssignedCategories(user.assignedCategories)}</strong>
  </div>

  <div className="user-table-cell user-table-created">
    <span>Created</span>
    <strong>{formatCreatedAt(user.createdAt)}</strong>
  </div>

  <div className="user-table-cell user-table-status">
    <span>Status</span>
    <strong className={`user-borrowing-status-text status-${getBorrowingStatusClass(user)}`}>
      {getBorrowingStatusLabel(user)}
    </strong>
  </div>
</div>

<div className="user-info-grid">
                        <div>
                          <span>User Type</span>
                          <strong>{getUserTypeLabel(user)}</strong>
                        </div>

                        <div>
                          <span>ID Number</span>
                          <strong>{getIdNumberLabel(user)}</strong>
                        </div>

                        <div>
                          <span>Course / Department</span>
                          <strong>
                            {user.role === "borrower"
                              ? user.courseDepartment || "Not set"
                              : "N/A"}
                          </strong>
                        </div>

                        <div>
                          <span>Year / Section</span>
                          <strong>{getYearSectionLabel(user)}</strong>
                        </div>

                        <div>
                          <span>Mobile Number</span>
                          <strong>
                            {user.role === "borrower"
                              ? user.mobileNumber || "Not set"
                              : "N/A"}
                          </strong>
                        </div>

                        <div>
                          <span>Assigned Categories</span>
                          <strong>
                            {formatAssignedCategories(user.assignedCategories)}
                          </strong>
                        </div>

                        <div>
                          <span>Overdue Count</span>
                          <strong>{user.overdueCount || 0}</strong>
                        </div>

                        <div>
                          <span>Can Borrow</span>
                          <strong>
                            {user.canBorrow === false ? "No" : "Yes"}
                          </strong>
                        </div>

                        <div>
                          <span>Suspended Until</span>
                          <strong>
                            {formatSuspendedUntil(user.suspendedUntil)}
                          </strong>
                        </div>
                      </div>

                      {user.suspensionReason && (
                        <div className="user-suspension-note">
                          <span>Suspension Reason</span>
                          <p>{user.suspensionReason}</p>
                        </div>
                      )}
<div className="user-actions" aria-label={`Actions for ${user.fullName || user.email || "user"}`}>
  <button
    type="button"
    className="user-view-btn user-icon-action user-action-view"
    onClick={() => setViewingUser(user)}
    aria-label={`View ${user.fullName || user.email || "user"}`}
    title="View"
    data-tooltip="View"
  >
    <span className="user-action-symbol" aria-hidden="true">i</span>
    <span className="user-action-label">View</span>
  </button>

  <button
    type="button"
    className="user-secondary-btn user-icon-action user-action-edit"
    onClick={() => startEditingUser(user)}
    aria-label={`Edit ${user.fullName || user.email || "user"}`}
    title="Edit"
    data-tooltip="Edit"
  >
    <span className="user-action-symbol" aria-hidden="true">✎</span>
    <span className="user-action-label">Edit</span>
  </button>

  <button
    type="button"
    className={`${
      isBorrowingRestrictionActive(user) ? "user-primary-btn" : "user-warning-btn"
    } user-icon-action user-action-borrow`}
    onClick={() => handleToggleBorrowing(user)}
    disabled={updatingId === user.id || user.isActive === false}
    aria-label={isBorrowingRestrictionActive(user) ? "Enable borrowing" : "Disable borrowing"}
    title={isBorrowingRestrictionActive(user) ? "Enable Borrow" : "Disable Borrow"}
    data-tooltip={isBorrowingRestrictionActive(user) ? "Enable Borrow" : "Disable Borrow"}
  >
    <span className="user-action-symbol" aria-hidden="true">{isBorrowingRestrictionActive(user) ? "✓" : "⊘"}</span>
    <span className="user-action-label">
      {isBorrowingRestrictionActive(user) ? "Enable Borrow" : "Disable Borrow"}
    </span>
  </button>

  <button
    type="button"
    className={`${
      user.isActive === false ? "user-secondary-btn" : "user-danger-btn"
    } user-icon-action user-action-account`}
    onClick={() => handleToggleAccountStatus(user)}
    disabled={
      updatingId === user.id ||
      user.role === "superAdmin" ||
      currentAdmin?.uid === user.id
    }
    aria-label={user.isActive === false ? "Enable account" : "Disable account"}
    title={user.isActive === false ? "Enable Account" : "Disable Account"}
    data-tooltip={user.isActive === false ? "Enable Account" : "Disable Account"}
  >
    <span className="user-action-symbol" aria-hidden="true">⏻</span>
    <span className="user-action-label">
      {user.isActive === false ? "Enable Account" : "Disable Account"}
    </span>
  </button>

  <button
    type="button"
    className={`${
      shouldShowRestoreBorrowingAccess(user) ? "user-primary-btn" : "user-danger-btn"
    } user-icon-action user-action-reset`}
    onClick={() =>
      shouldShowRestoreBorrowingAccess(user)
        ? handleRestoreBorrowingAccess(user)
        : handleResetSuspension(user)
    }
    disabled={updatingId === user.id || user.isActive === false}
    aria-label={
      shouldShowRestoreBorrowingAccess(user)
        ? "Restore borrowing access"
        : "Reset suspension"
    }
    title={shouldShowRestoreBorrowingAccess(user) ? "Restore Access" : "Reset"}
    data-tooltip={shouldShowRestoreBorrowingAccess(user) ? "Restore Access" : "Reset"}
  >
    <span className="user-action-symbol" aria-hidden="true">
      {shouldShowRestoreBorrowingAccess(user) ? "✓" : "↺"}
    </span>
    <span className="user-action-label">
      {shouldShowRestoreBorrowingAccess(user) ? "Restore" : "Reset"}
    </span>
  </button>

  <button
    type="button"
    className="user-delete-btn user-icon-action user-action-delete"
    onClick={() => handleDeleteUser(user)}
    disabled={
      updatingId === user.id ||
      user.role === "superAdmin" ||
      currentAdmin?.uid === user.id
    }
    aria-label="Delete user"
    title="Delete"
    data-tooltip={updatingId === user.id ? "Deleting" : "Delete"}
  >
    <span className="user-action-symbol" aria-hidden="true">{updatingId === user.id ? "…" : "×"}</span>
    <span className="user-action-label">{updatingId === user.id ? "Deleting" : "Delete"}</span>
  </button>
</div>
                    </article>
                  );
                })}
              </div>
                </div>
              </div>

              {hasMoreUsers && (
                <div className="user-load-more-row">
                  <button
                    type="button"
                    className="user-secondary-btn"
                    onClick={handleLoadMoreUsers}
                    disabled={loadingMoreUsers}
                  >
                    {loadingMoreUsers ? "Loading..." : "Load More Users"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
                {editingUser && (
          <div
            className="user-view-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Edit user"
          >
            <section className="user-view-modal user-edit-modal">
              <button
                type="button"
                className="user-modal-close-btn"
onClick={confirmDiscardEditChanges}
                aria-label="Close edit user"
              >
                Close
              </button>

              <div className="user-section-heading">
                <h2>Edit User</h2>
                <p>
                  Update role, assigned categories, and borrower details for{" "}
                  <strong>{editingUser.fullName || editingUser.email}</strong>.
                </p>
              </div>

              <div className="user-view-role-row">
                <strong className={`role-${editingUser.role || "borrower"}`}>
                  {getRoleLabel(editingUser.role)}
                </strong>

                <span title={editingUser.email || ""}>{editingUser.email || "No email"}</span>
              </div>

             <div
  className="user-edit-panel user-edit-panel-modal"
  onChange={markEditChanged}
>
                <div className="user-edit-name-email-row">
                <div className="user-field">
                  <label className="qb-label" htmlFor="edit-full-name">
                    Full Name <span className="required-star">*</span>
                  </label>

                  <input
                    id="edit-full-name"
                    type="text"
                    className={editFieldErrors.editFullName ? "input-error" : ""}
                    placeholder="Example: Juan Dela Cruz"
                    value={editFullName}
                    maxLength={EDIT_FULL_NAME_MAX_LENGTH}
                    onFocus={() => clearEditFieldError("editFullName")}
                    onBlur={() => validateEditUserField("editFullName")}
                    onChange={(e) => {
                      const sanitizedName = sanitizeEditFullNameInput(e.target.value);

                      setEditFullName(sanitizedName);
                      clearEditFieldError("editFullName");

                      if (sanitizedName !== e.target.value) {
                        setEditFieldErrors((previousErrors) => ({
                          ...previousErrors,
                          editFullName:
                            "Full name can only contain letters and spaces (no numbers or symbols).",
                        }));
                      }
                    }}
                    disabled={updatingId === editingUser.id}
                  />

                  {editFieldErrors.editFullName && (
                    <p className="field-error-message">
                      {editFieldErrors.editFullName}
                    </p>
                  )}
                </div>

                <div className="user-field">
                  <label className="qb-label" htmlFor="edit-email">
                    Email <span className="required-star">*</span>
                  </label>

                  <input
                    id="edit-email"
                    type="email"
                    className={editFieldErrors.editEmail ? "input-error" : ""}
                    placeholder="example@email.com"
                    value={editEmail}
                    onFocus={() => clearEditFieldError("editEmail")}
                    onBlur={() => validateEditUserField("editEmail")}
                    onChange={(e) => {
                      setEditEmail(e.target.value);
                      clearEditFieldError("editEmail");
                      markEditChanged();
                    }}
                    disabled={updatingId === editingUser.id}
                  />

                  {editFieldErrors.editEmail && (
                    <p className="field-error-message">
                      {editFieldErrors.editEmail}
                    </p>
                  )}
                </div>
                </div>

                <div className="user-field">
                  <label className="qb-label">
                    Edit Role <span className="required-star">*</span>
                  </label>

                  <select
                    className={editFieldErrors.editRole ? "input-error" : ""}
                    value={editRole}
                    onFocus={() => clearEditFieldError("editRole")}
                    onBlur={() => validateEditUserField("editRole")}
                    onChange={(e) => {
                      setEditRole(e.target.value);
                      clearEditFieldError("editRole");
                      clearEditFieldError("editAssignedCategories");

                      if (e.target.value !== "categoryAdmin") {
                        setEditAssignedCategories([]);
                      }

                      if (e.target.value !== "borrower") {
                        setEditUserType("Student");
                        setEditStudentNumber("");
                        setEditEmployeeId("");
                        setEditCourseDepartment("");
                        setEditYearLevel("");
                        setEditSection("");
                        setEditMobileNumber("");
                      }
                    }}
                    disabled={updatingId === editingUser.id}
                  >
                    <option value="borrower">Borrower</option>
                    <option value="categoryAdmin">Category Admin / Mini Admin</option>
                    <option value="superAdmin">Super Admin</option>
                  </select>

                  {editFieldErrors.editRole && (
                    <p className="field-error-message">
                      {editFieldErrors.editRole}
                    </p>
                  )}
                </div>

                {editRole === "borrower" && (
                  <div className="user-borrower-details-box compact">
                    <span>Edit Borrower Details</span>

                    <div className="user-borrower-details-grid">
                      <div className="user-field">
                        <label className="qb-label">User Type</label>

                        <select
                          value={editUserType}
                          onChange={(e) => {
                            setEditUserType(e.target.value);
                            setEditStudentNumber("");
                            setEditEmployeeId("");
                            setEditYearLevel("");
                            setEditSection("");
                          }}
                          disabled={updatingId === editingUser.id}
                        >
                          {USER_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>

                      {editUserType === "Student" ? (
                        <div className="user-field">
                          <label className="qb-label">Student Number</label>

                          <input
                            type="text"
                            inputMode="numeric"
                            className={
                              editFieldErrors.editStudentNumber ? "input-error" : ""
                            }
                            value={editStudentNumber}
                            maxLength={STUDENT_NUMBER_MAX_LENGTH}
                            onFocus={() => clearEditFieldError("editStudentNumber")}
                            onBlur={() => validateEditUserField("editStudentNumber")}
                            onChange={(e) => {
                              const sanitizedNumber = sanitizeStudentNumberInput(
                                e.target.value
                              );

                              setEditStudentNumber(sanitizedNumber);
                              clearEditFieldError("editStudentNumber");

                              if (sanitizedNumber !== e.target.value) {
                                setEditFieldErrors((previousErrors) => ({
                                  ...previousErrors,
                                  editStudentNumber:
                                    "Student number can only contain numbers.",
                                }));
                              }
                            }}
                            disabled={updatingId === editingUser.id}
                          />

                          {editFieldErrors.editStudentNumber && (
                            <p className="field-error-message">
                              {editFieldErrors.editStudentNumber}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="user-field">
                          <label className="qb-label">Employee ID</label>

                          <input
                            type="text"
                            value={editEmployeeId}
                            onChange={(e) => setEditEmployeeId(e.target.value)}
                            disabled={updatingId === editingUser.id}
                          />
                        </div>
                      )}

                      <div className="user-field">
                        <label className="qb-label">Course / Department</label>

                        <input
                          type="text"
                          value={editCourseDepartment}
                          onChange={(e) => setEditCourseDepartment(e.target.value)}
                          disabled={updatingId === editingUser.id}
                        />
                      </div>

                      {editUserType === "Student" && (
                        <>
                          <div className="user-field">
                            <label className="qb-label">Year Level</label>

                            <select
                              value={editYearLevel}
                              onChange={(e) => setEditYearLevel(e.target.value)}
                              disabled={updatingId === editingUser.id}
                            >
                              <option value="">Select Year Level</option>
                              {YEAR_LEVELS.map((year) => (
                                <option key={year} value={year}>
                                  {year}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="user-field">
                            <label className="qb-label">Section</label>

                            <input
                              type="text"
                              className={
                                editFieldErrors.editSection ? "input-error" : ""
                              }
                              value={editSection}
                              maxLength={SECTION_MAX_LENGTH}
                              onFocus={() => clearEditFieldError("editSection")}
                              onBlur={() => validateEditUserField("editSection")}
                              onChange={(e) => {
                                const sanitizedSection = sanitizeSectionInput(
                                  e.target.value
                                );

                                setEditSection(sanitizedSection);
                                clearEditFieldError("editSection");

                                if (sanitizedSection !== e.target.value) {
                                  setEditFieldErrors((previousErrors) => ({
                                    ...previousErrors,
                                    editSection:
                                      "Section can only contain letters, numbers, and spaces (no symbols).",
                                  }));
                                }
                              }}
                              disabled={updatingId === editingUser.id}
                            />

                            {editFieldErrors.editSection && (
                              <p className="field-error-message">
                                {editFieldErrors.editSection}
                              </p>
                            )}
                          </div>
                        </>
                      )}

                      <div className="user-field">
                        <label className="qb-label">Mobile Number</label>

                        <input
                          type="text"
                          value={editMobileNumber}
                          onChange={(e) => setEditMobileNumber(e.target.value)}
                          disabled={updatingId === editingUser.id}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {editRole === "categoryAdmin" && (
                  <div
  className="user-category-box compact"
  onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      validateEditUserField("editAssignedCategories");
    }
  }}
>
                    <span>
                      Edit Assigned Category{" "}
                      <span className="required-star">*</span>
                    </span>
                    <p className="user-small-note user-category-assignment-note">
                      Mini admin can manage only one available category.
                    </p>

                    {categories.length === 0 ? (
                      <p className="user-small-note">No categories available.</p>
                    ) : (
                      <div className="user-category-grid">
                        {categories.map((category) => {
                          const assignedOwner = getCategoryAdminOwner(
                            category.id,
                            editingUser.id
                          );
                          const isAssignedToOtherAdmin = Boolean(assignedOwner);
                          const isSelected = editAssignedCategories.includes(
                            category.id
                          );

                          return (
                            <label
                              key={category.id}
                              className={`user-category-option ${
                                isSelected ? "user-category-option-selected" : ""
                              } ${
                                isAssignedToOtherAdmin
                                  ? "user-category-option-disabled"
                                  : ""
                              }`}
                              title={
                                isAssignedToOtherAdmin
                                  ? getCategoryAlreadyAssignedMessage(
                                      category.id,
                                      editingUser.id
                                    )
                                  : "Available category"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  handleEditCategoryToggle(category.id);
                                  clearEditFieldError("editAssignedCategories");
                                }}
                                disabled={
                                  updatingId === editingUser.id ||
                                  isAssignedToOtherAdmin
                                }
                              />

                              <span className="user-category-option-text">
                                <strong>{category.name}</strong>
                                {isAssignedToOtherAdmin && (
                                  <small>
                                    Assigned to{" "}
                                    {assignedOwner.fullName ||
                                      assignedOwner.email ||
                                      "another mini admin"}
                                  </small>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {editFieldErrors.editAssignedCategories && (
                      <p className="field-error-message">
                        {editFieldErrors.editAssignedCategories}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="user-edit-panel user-edit-password-panel">
                <div className="user-edit-password-panel-header">
                  <strong>Set New Password</strong>
                  <span>Optional — leave blank to keep the current password</span>
                </div>

                <div className="user-edit-password-fields">
                  <div className="user-field">
                    <label className="qb-label" htmlFor="edit-new-password">
                      New Password
                    </label>

                    <div className="user-password-field-wrapper">
                      <input
                        id="edit-new-password"
                        type={showEditNewPassword ? "text" : "password"}
                        className={passwordFieldErrors.editNewPassword ? "input-error" : ""}
                        placeholder="New password"
                        value={editNewPassword}
                        autoComplete="new-password"
                        onFocus={() =>
                          setPasswordFieldErrors((previousErrors) => {
                            const nextErrors = { ...previousErrors };
                            delete nextErrors.editNewPassword;
                            return nextErrors;
                          })
                        }
                        onChange={(e) => setEditNewPassword(e.target.value)}
                        disabled={settingPasswordId === editingUser.id}
                      />

                      <button
                        type="button"
                        className="user-password-toggle-btn"
                        onClick={() => setShowEditNewPassword((previous) => !previous)}
                        disabled={settingPasswordId === editingUser.id}
                      >
                        {showEditNewPassword ? "Hide" : "Show"}
                      </button>
                    </div>

                    {passwordFieldErrors.editNewPassword && (
                      <p className="field-error-message">
                        {passwordFieldErrors.editNewPassword}
                      </p>
                    )}
                  </div>

                  <div className="user-field">
                    <label className="qb-label" htmlFor="edit-confirm-password">
                      Confirm Password
                    </label>

                    <input
                      id="edit-confirm-password"
                      type={showEditNewPassword ? "text" : "password"}
                      className={passwordFieldErrors.editConfirmPassword ? "input-error" : ""}
                      placeholder="Re-enter password"
                      value={editConfirmPassword}
                      autoComplete="new-password"
                      onFocus={() =>
                        setPasswordFieldErrors((previousErrors) => {
                          const nextErrors = { ...previousErrors };
                          delete nextErrors.editConfirmPassword;
                          return nextErrors;
                        })
                      }
                      onChange={(e) => setEditConfirmPassword(e.target.value)}
                      disabled={settingPasswordId === editingUser.id}
                    />

                    {passwordFieldErrors.editConfirmPassword && (
                      <p className="field-error-message">
                        {passwordFieldErrors.editConfirmPassword}
                      </p>
                    )}
                  </div>
                </div>

                <div className="user-view-actions">
                  <button
                    type="button"
                    className="user-secondary-btn"
                    onClick={() => handleSetUserPassword(editingUser)}
                    disabled={
                      settingPasswordId === editingUser.id || !editNewPassword
                    }
                  >
                    {settingPasswordId === editingUser.id
                      ? "Setting Password..."
                      : "Set Password"}
                  </button>
                </div>
              </div>

              <div className="user-view-actions user-edit-modal-actions">
                <button
                  type="button"
                  className="user-secondary-btn"
onClick={confirmDiscardEditChanges}
                  disabled={updatingId === editingUser.id}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="user-primary-btn"
                  onClick={() => handleSaveUserChanges(editingUser)}
                  disabled={updatingId === editingUser.id}
                >
                  {updatingId === editingUser.id ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </section>
          </div>
        )}

        {viewingUser && (
          <div
            className="user-view-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="User details"
          >
            <section className="user-view-modal">
            <button
              type="button"
              className="user-modal-close-btn user-modal-close-x"
              onClick={() => setViewingUser(null)}
              aria-label="Close user details"
            >
              ×
            </button>

              <div className="user-section-heading">
                <h2>{viewingUser.fullName || "No name"}</h2>
                <p>{viewingUser.email || "No email"}</p>
              </div>

              <div className="user-view-role-row">
                <strong className={`role-${viewingUser.role || "borrower"}`}>
                  {getRoleLabel(viewingUser.role)}
                </strong>

                <span className={`user-borrowing-status-text status-${getBorrowingStatusClass(viewingUser)}`}>
                  {getBorrowingStatusLabel(viewingUser)}
                </span>
              </div>

              <div className="user-view-grid">
                <div>
                  <span>User Type</span>
                  <strong>{getUserTypeLabel(viewingUser)}</strong>
                </div>

                <div>
                  <span>ID Number</span>
                  <strong>{getIdNumberLabel(viewingUser)}</strong>
                </div>

                <div>
                  <span>Course / Department</span>
                  <strong>
                    {viewingUser.role === "borrower"
                      ? viewingUser.courseDepartment || "Not set"
                      : "N/A"}
                  </strong>
                </div>

                <div>
                  <span>Year / Section</span>
                  <strong>{getYearSectionLabel(viewingUser)}</strong>
                </div>

                <div>
                  <span>Mobile Number</span>
                  <strong>
                    {viewingUser.role === "borrower"
                      ? viewingUser.mobileNumber || "Not set"
                      : "N/A"}
                  </strong>
                </div>

                <div>
                  <span>Assigned Categories</span>
                  <strong>
                    {formatAssignedCategories(viewingUser.assignedCategories)}
                  </strong>
                </div>

                <div>
                  <span>Overdue Count</span>
                  <strong>{viewingUser.overdueCount || 0}</strong>
                </div>

                <div>
                  <span>Can Borrow</span>
                  <strong>{viewingUser.canBorrow === false ? "No" : "Yes"}</strong>
                </div>

                <div>
                  <span>Restriction Ends</span>
                  <strong>{getRestrictionEndsLabel(viewingUser)}</strong>
                </div>

                <div>
                  <span>Created</span>
                  <strong>{formatCreatedAt(viewingUser.createdAt)}</strong>
                </div>
              </div>

              {shouldShowRestrictionReason(viewingUser) && (
                <div className="user-view-note">
                  <span>Borrowing Restriction Reason</span>
                  <p>{viewingUser.suspensionReason}</p>
                </div>
              )}

              {viewingUser.role === "borrower" && (
                <section className="user-penalty-history-card">
                  <div className="user-penalty-history-heading">
                    <div>
                      <span>Penalty History</span>
                      <strong>
                        {getPenaltyRecordsForUser(viewingUser.id).length} record
                        {getPenaltyRecordsForUser(viewingUser.id).length === 1 ? "" : "s"}
                      </strong>
                    </div>
                    <p>
                      Shows temporary borrowing restrictions caused by expired
                      approved requests or admin resolution actions.
                    </p>
                  </div>

                  {getPenaltyRecordsForUser(viewingUser.id).length === 0 ? (
                    <p className="user-penalty-empty">
                      No penalty or restriction history recorded for this borrower.
                    </p>
                  ) : (
                    <div className="user-penalty-list">
                      {getPenaltyRecordsForUser(viewingUser.id)
                        .slice(0, 5)
                        .map((record) => (
                          <article className="user-penalty-item" key={record.id}>
                            <div>
                              <strong>{record.penaltyType || "Borrowing Restriction"}</strong>
                              <span>{record.itemName || "No item linked"}</span>
                            </div>

                            <p>{record.reason || "No reason recorded."}</p>

                            <div className="user-penalty-meta">
                              <span>
                                Ends: {formatPenaltyDateTime(record.restrictionEndAt)}
                              </span>
                              <em className={`penalty-status-${getPenaltyStatusClass(record)}`}>
                                {getPenaltyStatusLabel(record)}
                              </em>
                            </div>
                          </article>
                        ))}
                    </div>
                  )}
                </section>
              )}

              {shouldShowRestoreBorrowingAccess(viewingUser) && (
                <div className="user-view-borrowing-banner">
                  <strong>Manual restore available</strong>
                  <p>
                    Admins can restore borrowing access if the restriction was
                    caused by a release or encoding mistake.
                  </p>
                </div>
              )}

              <div className="user-view-actions">
                {shouldShowRestoreBorrowingAccess(viewingUser) && (
                  <button
                    type="button"
                    className="user-primary-btn"
                    onClick={() => handleRestoreBorrowingAccess(viewingUser)}
                    disabled={updatingId === viewingUser.id}
                  >
                    {updatingId === viewingUser.id
                      ? "Restoring..."
                      : "Restore Borrowing Access"}
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

export default UserManagement;
