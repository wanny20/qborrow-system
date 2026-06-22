import { useEffect, useState } from "react";
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
import { useToast } from "../components/ToastProvider.jsx";
import "../styles/UserManagement.css";

const USERS_PAGE_SIZE = 5;
const USER_TYPES = ["Student", "Faculty", "Staff"];
const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];

function UserManagement() {
const navigate = useNavigate();
const outletContext = useOutletContext() || {};
const { userData: currentAdmin } = outletContext;
const { showToast } = useToast();
const [searchParams, setSearchParams] = useSearchParams();


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

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [categoryAction, setCategoryAction] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
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

  const [csvFileName, setCsvFileName] = useState("");
  const [csvBorrowers, setCsvBorrowers] = useState([]);
  const [importResults, setImportResults] = useState([]);

  const [editingUserId, setEditingUserId] = useState("");
  const [viewingUser, setViewingUser] = useState(null);
  const [editRole, setEditRole] = useState("borrower");
  const [editAssignedCategories, setEditAssignedCategories] = useState([]);

  const [editUserType, setEditUserType] = useState("Student");
  const [editStudentNumber, setEditStudentNumber] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editCourseDepartment, setEditCourseDepartment] = useState("");
  const [editYearLevel, setEditYearLevel] = useState("");
  const [editSection, setEditSection] = useState("");
  const [editMobileNumber, setEditMobileNumber] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("");
  const [createFieldErrors, setCreateFieldErrors] = useState({});
  const [categoryFieldErrors, setCategoryFieldErrors] = useState({});
  const [csvFieldErrors, setCsvFieldErrors] = useState({});
  const [editFieldErrors, setEditFieldErrors] = useState({});

  function showStatus(message, type) {
    setStatusMessage(message);
    setStatusType(type);
  }

function closeUserToolModal() {
  setActiveUserTool("");
  setSearchParams({});
}

  function clearCreateFieldError(fieldName) {
  setCreateFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function clearCategoryFieldError(fieldName) {
  setCategoryFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function clearCsvFieldError(fieldName) {
  setCsvFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}
function clearEditFieldError(fieldName) {
  setEditFieldErrors((previousErrors) => ({
    ...previousErrors,
    [fieldName]: "",
  }));
}

function validateEditUserForm() {
  const errors = {};

  if (!editRole) {
    errors.editRole = "Role is required.";
  }

  if (editRole === "categoryAdmin" && categories.length === 0) {
    errors.editAssignedCategories = "Please add or seed categories first.";
  }

  if (editRole === "categoryAdmin" && editAssignedCategories.length === 0) {
    errors.editAssignedCategories =
      "Category admin must have at least one assigned category.";
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

function validateCreateUserForm() {
  const errors = {};

  if (!fullName.trim()) {
    errors.fullName = "Full name is required.";
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
  }

  if (role === "categoryAdmin" && assignedCategories.length === 0) {
    errors.assignedCategories =
      "Please assign at least one category for category admin.";
  }

  setCreateFieldErrors(errors);

  return Object.keys(errors).length === 0;
}

function validateAddCategoryForm() {
  const errors = {};

  if (!newCategoryName.trim()) {
    errors.newCategoryName = "Category name is required.";
  }

  setCategoryFieldErrors(errors);

  return Object.keys(errors).length === 0;
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
    if (!value) return "Not suspended";

    if (typeof value?.toDate === "function") {
      return value.toDate().toLocaleDateString();
    }

    if (typeof value === "string") {
      return value || "Not suspended";
    }

    return "Not suspended";
  }

 function isUserSuspended(user) {
  if (!user?.suspendedUntil) return false;

  const suspendedDate =
    typeof user.suspendedUntil?.toDate === "function"
      ? user.suspendedUntil.toDate()
      : new Date(user.suspendedUntil);

  if (!suspendedDate || Number.isNaN(suspendedDate.getTime())) {
    return false;
  }

  return suspendedDate > new Date();
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
      const [categoriesSnapshot, itemsSnapshot, requestsSnapshot] =
        await Promise.all([
          getDocs(collection(db, "categories")),
          getDocs(collection(db, "items")),
          getDocs(collection(db, "borrowRequests")),
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

      setCategories(categoryData);
      setItems(itemData);
      setBorrowRequests(requestData);

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
    setAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return previousCategories.filter((category) => category !== categoryId);
      }

      return [...previousCategories, categoryId];
    });
  }

  function handleEditCategoryToggle(categoryId) {
    setEditAssignedCategories((previousCategories) => {
      if (previousCategories.includes(categoryId)) {
        return previousCategories.filter((category) => category !== categoryId);
      }

      return [...previousCategories, categoryId];
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

function resetCreateForm() {
  setFullName("");
  setEmail("");
  setTemporaryPassword("");
  setRole("borrower");
  setAssignedCategories([]);
  setCreateFieldErrors({});
  resetBorrowerDetails();
}

async function handleCreateUser(e) {
  e.preventDefault();
  showStatus("", "");

const isValid = validateCreateUserForm();

if (!isValid) {
  return;
}

const duplicateError = await getCreateDuplicateError();

if (duplicateError) {
  showStatus(duplicateError, "error");
  return;
}

setCreating(true);

    try {
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
        assignedCategories: role === "categoryAdmin" ? assignedCategories : [],
        ...getBorrowerDetailsPayload(role),
        overdueCount: 0,
        suspendedUntil: "",
        suspensionReason: "",
        canBorrow: true,
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
        fetchData();

    } catch (error) {
      if (error.code === "auth/email-already-in-use") {
  showStatus(
    "This email is already registered. Please use a different email address.",
    "error"
  );

  setCreateFieldErrors((previousErrors) => ({
    ...previousErrors,
    email: "This email is already registered.",
  }));

  return;
}

showStatus("Error creating user: " + error.message, "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleSeedCategories() {
    const confirmSeed = window.confirm(
      "Seed default categories: Sports, Laboratory, STEM, and IT?"
    );

    if (!confirmSeed) return;

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
      showStatus("Error seeding categories: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
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
      fetchData();

    } catch (error) {
      showStatus("Error adding category: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
  }

  async function handleDeleteCategory(category) {
    const usage = getCategoryUsage(category.id);

    if (!usage.canDelete) {
      showStatus(
        "This category cannot be deleted because it is still used by items, admins, or borrow requests.",
        "error"
      );
      return;
    }

    const confirmDelete = window.confirm(
      `Delete category "${category.name}"? This is allowed only because it has no items, admins, or borrow requests.`
    );

    if (!confirmDelete) return;

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
      showStatus("Error deleting category: " + error.message, "error");
    } finally {
      setCategoryAction("");
    }
  }

  function startEditingUser(user) {
    setEditFieldErrors({});
    setEditingUserId(user.id);
    setEditRole(user.role || "borrower");
    setEditAssignedCategories(
      Array.isArray(user.assignedCategories) ? user.assignedCategories : []
    );

    setEditUserType(getSafeUserType(user.userType));
    setEditStudentNumber(user.studentNumber || "");
    setEditEmployeeId(user.employeeId || "");
    setEditCourseDepartment(user.courseDepartment || "");
    setEditYearLevel(user.yearLevel || "");
    setEditSection(user.section || "");
    setEditMobileNumber(user.mobileNumber || "");
  }

  function cancelEditingUser() {
    setEditFieldErrors({});
    setEditingUserId("");
    setEditRole("borrower");
    setEditAssignedCategories([]);

    setEditUserType("Student");
    setEditStudentNumber("");
    setEditEmployeeId("");
    setEditCourseDepartment("");
    setEditYearLevel("");
    setEditSection("");
    setEditMobileNumber("");
  }

async function handleSaveUserChanges(user) {
  showStatus("", "");

  const isValid = validateEditUserForm();

if (!isValid) {
  return;
}
setUpdatingId(user.id);

    try {
      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        role: editRole,
        assignedCategories:
          editRole === "categoryAdmin" ? editAssignedCategories : [],
        ...getEditBorrowerDetailsPayload(editRole),
        updatedAt: serverTimestamp(),
      });

      showToast("Successfully Updated", "success");
      cancelEditingUser();
      fetchData();

    } catch (error) {
      showStatus("Error updating user: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleToggleBorrowing(user) {
    const nextValue = user.canBorrow === false;

    const confirmAction = window.confirm(
      nextValue
        ? `Enable borrowing for ${user.fullName || user.email}?`
        : `Disable borrowing for ${user.fullName || user.email}?`
    );

    if (!confirmAction) return;

    setUpdatingId(user.id);
    showStatus("", "");

    try {
      const userRef = doc(db, "users", user.id);

      await updateDoc(userRef, {
        canBorrow: nextValue,
        updatedAt: serverTimestamp(),
      });

      showToast(
        nextValue ? "Borrowing Enabled" : "Borrowing Disabled",
        "success"
      );

      fetchData();
    } catch (error) {
      showStatus("Error updating borrowing status: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleResetSuspension(user) {
    const confirmReset = window.confirm(
      `Reset suspension and overdue count for ${user.fullName || user.email}?`
    );

    if (!confirmReset) return;

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

      showToast("Suspension Reset", "success");
      fetchData();
    } catch (error) {
      showStatus("Error resetting suspension: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleDeleteUser(user) {
    if (user.role === "superAdmin") {
      showStatus("Super admin accounts cannot be deleted here.", "error");
      return;
    }

    if (currentAdmin?.uid === user.id) {
      showStatus("You cannot delete your own account.", "error");
      return;
    }

    const confirmDelete = window.confirm(
      `Permanently delete ${user.fullName || user.email}? This deletes the Firebase Auth account and Firestore user record.`
    );

    if (!confirmDelete) return;

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
      showStatus("Error deleting user: " + error.message, "error");
    } finally {
      setUpdatingId("");
    }
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

      showStatus(
        `CSV loaded: ${borrowers.length} borrower${borrowers.length === 1 ? "" : "s"} ready for import.`,
        "success"
      );
    } catch (error) {
      showStatus("Error reading CSV: " + error.message, "error");
    }
  }

  function clearCsvImport() {
    setCsvFileName("");
    setCsvBorrowers([]);
    setImportResults([]);
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

    const confirmImport = window.confirm(
      `Import ${csvBorrowers.length} borrower account${csvBorrowers.length === 1 ? "" : "s"}?`
    );

    if (!confirmImport) return;

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
      showStatus("Error importing borrowers: " + error.message, "error");
    } finally {
      setImportingCsv(false);
    }
  }

  function getCategoryUsage(categoryId) {
    const normalizedCategoryId = normalizeText(categoryId);

    const itemCount = items.filter((item) => {
      const itemCategory = normalizeText(item.categoryId || item.category);
      return itemCategory === normalizedCategoryId;
    }).length;

    const adminCount = users.filter((user) => {
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

    return {
      itemCount,
      adminCount,
      requestCount,
      canDelete: itemCount === 0 && adminCount === 0 && requestCount === 0,
    };
  }

useEffect(() => {
  fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

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
      onClick={() => navigate("/dashboard")}
    >
      Back to Dashboard
    </button>
  </div>
</section>

      {statusMessage && (
        <div
          className={`user-management-status user-management-status-${statusType}`}
          role="status"
        >
          {statusMessage}
        </div>
      )}

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

<section className="user-management-layout">
  <div className={`user-left-stack ${activeUserTool ? "user-modal-open" : ""}`}>
          <section
  className={`user-create-card user-tool-modal-card ${
    activeUserTool === "create" ? "user-tool-active" : ""
  }`}
>
  <button
    type="button"
    className="user-modal-close-btn"
    onClick={closeUserToolModal}
    aria-label="Close Add User modal"
  >
    Close
  </button>
<div className="user-modal-hero">
  <div className="user-modal-hero-text">
    <h2>Create User</h2>
    <p>
      Use a temporary password. Borrower details are optional but
      recommended for students, faculty, and staff.
    </p>
  </div>
</div>

            <form onSubmit={handleCreateUser} noValidate>
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
    onChange={(e) => {
      setFullName(e.target.value);
      clearCreateFieldError("fullName");
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

  <input
    id="temporary-password"
    type="password"
    className={createFieldErrors.temporaryPassword ? "input-error" : ""}
    placeholder="At least 6 characters"
    value={temporaryPassword}
    onFocus={() => clearCreateFieldError("temporaryPassword")}
    onChange={(e) => {
      setTemporaryPassword(e.target.value);
      clearCreateFieldError("temporaryPassword");
    }}
    disabled={creating}
  />

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
                <div className="user-category-box">
                  <span>
  Assigned Categories <span className="required-star">*</span>
</span>

                  {categories.length === 0 ? (
                    <p className="user-small-note">
                      No categories yet. Seed defaults or add a category first.
                    </p>
                  ) : (
                    <div className="user-category-grid">
                      {categories.map((category) => (
                        <label key={category.id}>
                          <input
                            type="checkbox"
                            checked={assignedCategories.includes(category.id)}
                            onChange={() => {
  handleCategoryToggle(category.id);
  clearCreateFieldError("assignedCategories");
}}
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
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
                className="user-primary-btn"
                disabled={creating}
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
  <button
    type="button"
    className="user-modal-close-btn"
    onClick={closeUserToolModal}
    aria-label="Close Categories modal"
  >
    Close
  </button>

<div className="user-modal-hero">
  <div className="user-modal-hero-text">
    <h2>Manage Item Categories</h2>
    <p>
      Categories organize inventory items and define what category admins are
      allowed to manage. Delete is allowed only when a category is unused.
    </p>
  </div>
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

            <form className="user-category-add-form" onSubmit={handleAddCategory} noValidate>
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
    onFocus={() => clearCategoryFieldError("newCategoryName")}
    onChange={(event) => {
      setNewCategoryName(event.target.value);
      clearCategoryFieldError("newCategoryName");
    }}
    disabled={categoryAction === "add"}
  />

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
            <th>Requests</th>
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
                <td>{usage.requestCount}</td>

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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
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
    <strong>
      {user.canBorrow === false
        ? "Disabled"
        : isUserSuspended(user)
        ? "Suspended"
        : "Active"}
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



<div className="user-actions">
  <>
    <button
      type="button"
      className="user-view-btn"
      onClick={() => setViewingUser(user)}
    >
      View
    </button>

    <button
      type="button"
      className="user-secondary-btn"
      onClick={() => startEditingUser(user)}
    >
      Edit
    </button>

                            <button
                              type="button"
                              className={
                                user.canBorrow === false
                                  ? "user-primary-btn"
                                  : "user-warning-btn"
                              }
                              onClick={() => handleToggleBorrowing(user)}
                              disabled={updatingId === user.id}
                            >
                              {user.canBorrow === false ? "Enable" : "Disable"}
                            </button>

                            <button
                              type="button"
                              className="user-danger-btn"
                              onClick={() => handleResetSuspension(user)}
                              disabled={updatingId === user.id}
                            >
                              Reset
                            </button>

                            <button
                              type="button"
                              className="user-delete-btn"
                              onClick={() => handleDeleteUser(user)}
                              disabled={
                                updatingId === user.id ||
                                user.role === "superAdmin" ||
                                currentAdmin?.uid === user.id
                              }
                            >
                              {updatingId === user.id ? "Deleting..." : "Delete"}
                            </button>
  </>
</div>
                    </article>
                  );
                })}
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
                onClick={cancelEditingUser}
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

                <span>{editingUser.email || "No email"}</span>
              </div>

              <div className="user-edit-panel user-edit-panel-modal">
                <div className="user-field">
                  <label className="qb-label">
                    Edit Role <span className="required-star">*</span>
                  </label>

                  <select
                    className={editFieldErrors.editRole ? "input-error" : ""}
                    value={editRole}
                    onFocus={() => clearEditFieldError("editRole")}
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
                            value={editStudentNumber}
                            onChange={(e) => setEditStudentNumber(e.target.value)}
                            disabled={updatingId === editingUser.id}
                          />
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
                              value={editSection}
                              onChange={(e) => setEditSection(e.target.value)}
                              disabled={updatingId === editingUser.id}
                            />
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
                  <div className="user-category-box compact">
                    <span>
                      Edit Assigned Categories{" "}
                      <span className="required-star">*</span>
                    </span>

                    {categories.length === 0 ? (
                      <p className="user-small-note">No categories available.</p>
                    ) : (
                      <div className="user-category-grid">
                        {categories.map((category) => (
                          <label key={category.id}>
                            <input
                              type="checkbox"
                              checked={editAssignedCategories.includes(
                                category.id
                              )}
                              onChange={() => {
                                handleEditCategoryToggle(category.id);
                                clearEditFieldError("editAssignedCategories");
                              }}
                              disabled={updatingId === editingUser.id}
                            />

                            <span>{category.name}</span>
                          </label>
                        ))}
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

              <div className="user-view-actions user-edit-modal-actions">
                <button
                  type="button"
                  className="user-secondary-btn"
                  onClick={cancelEditingUser}
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
                className="user-modal-close-btn"
                onClick={() => setViewingUser(null)}
                aria-label="Close user details"
              >
                Close
              </button>

              <div className="user-section-heading">
                <h2>{viewingUser.fullName || "No name"}</h2>
                <p>{viewingUser.email || "No email"}</p>
              </div>

              <div className="user-view-role-row">
                <strong className={`role-${viewingUser.role || "borrower"}`}>
                  {getRoleLabel(viewingUser.role)}
                </strong>

                <span>
                  {viewingUser.canBorrow === false
                    ? "Borrowing Disabled"
                    : isUserSuspended(viewingUser)
                    ? "Suspended"
                    : "Active"}
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
                  <span>Suspended Until</span>
                  <strong>{formatSuspendedUntil(viewingUser.suspendedUntil)}</strong>
                </div>

                <div>
                  <span>Created</span>
                  <strong>{formatCreatedAt(viewingUser.createdAt)}</strong>
                </div>
              </div>

              {viewingUser.suspensionReason && (
                <div className="user-view-note">
                  <span>Suspension Reason</span>
                  <p>{viewingUser.suspensionReason}</p>
                </div>
              )}

              <div className="user-view-actions">
                <button
                  type="button"
                  className="user-secondary-btn"
                  onClick={() => setViewingUser(null)}
                >
                  Close
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

export default UserManagement;