import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import ForcePasswordChange from "./pages/ForcePasswordChange";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AddItem from "./pages/AddItem";
import ItemList from "./pages/ItemList";
import EditItem from "./pages/EditItem";
import ItemDetails from "./pages/ItemDetails";
import BorrowRequest from "./pages/BorrowRequest";
import ManageRequests from "./pages/ManageRequests";
import ReleaseItem from "./pages/ReleaseItem";
import ReturnConfirmation from "./pages/ReturnConfirmation";
import Reports from "./pages/Reports";
import ScanQR from "./pages/ScanQR";
import Notifications from "./pages/Notifications";
import MyRequests from "./pages/MyRequests";
import OverdueItems from "./pages/OverdueItems";
import UserManagement from "./pages/UserManagement";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";
import AdminDashboardList from "./pages/AdminDashboardList";
import Settings from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />

        {/* Protected App Routes */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          {/* Shared Authenticated Routes */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/items" element={<ItemList />} />
          <Route path="/item/:id" element={<ItemDetails />} />
          <Route path="/scan-qr" element={<ScanQR />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          

          {/* Optional alias if you accidentally type /scan */}
          <Route path="/scan" element={<Navigate to="/scan-qr" replace />} />

          {/* Borrower Routes */}
          <Route
            path="/borrow-request/:itemId"
            element={
              <ProtectedRoute allowedRoles={["borrower"]}>
                <BorrowRequest />
              </ProtectedRoute>
            }
          />

          <Route
            path="/my-requests"
            element={
              <ProtectedRoute allowedRoles={["borrower"]}>
                <MyRequests />
              </ProtectedRoute>
            }
          />

          <Route
            path="/my-overdue-items"
            element={
              <ProtectedRoute allowedRoles={["borrower"]}>
                <OverdueItems />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/add-item"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <AddItem />
              </ProtectedRoute>
            }
          />

          <Route
            path="/edit-item"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <EditItem />
              </ProtectedRoute>
            }
          />

          <Route
            path="/manage-requests"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <ManageRequests />
              </ProtectedRoute>
            }
          />

          <Route
            path="/release-item"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <ReleaseItem />
              </ProtectedRoute>
            }
          />

          <Route
            path="/return-confirmation"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <ReturnConfirmation />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                <Reports />
              </ProtectedRoute>
            }
          />

          {/* Super Admin Route */}
          <Route
            path="/user-management"
            element={
              <ProtectedRoute allowedRoles={["superAdmin"]}>
                <UserManagement />
              </ProtectedRoute>
            }
            
          />
            <Route
              path="/admin-list/:listType"
              element={
                <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin"]}>
                  <AdminDashboardList />
                </ProtectedRoute>
              }
            />
          {/* Unknown protected route */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
<Route
  path="/force-password-change"
  element={
    <ProtectedRoute allowedRoles={["superAdmin", "categoryAdmin", "borrower"]}>
      <ForcePasswordChange />
    </ProtectedRoute>
  }
/>
        {/* Unknown public route */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
