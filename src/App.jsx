import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AddItem from "./pages/AddItem";
import ItemList from "./pages/ItemList";
import EditItem from "./pages/EditItem";
import ItemDetails from "./pages/ItemDetails";
import BorrowRequest from "./pages/BorrowRequest";
import ManageRequests from "./pages/ManageRequests";
import ReturnConfirmation from "./pages/ReturnConfirmation";
import Reports from "./pages/Reports";
import ScanQR from "./pages/ScanQR";
import Notifications from "./pages/Notifications";
import MyRequests from "./pages/MyRequests";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/AppLayout";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />

        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/items" element={<ItemList />} />
          <Route path="/item/:id" element={<ItemDetails />} />
          <Route path="/borrow-request/:itemId" element={<BorrowRequest />} />
          <Route path="/scan-qr" element={<ScanQR />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/my-requests" element={<MyRequests />} />

          <Route
            path="/add-item"
            element={
              <ProtectedRoute allowedRole="admin">
                <AddItem />
              </ProtectedRoute>
            }
          />

          <Route
            path="/edit-item"
            element={
              <ProtectedRoute allowedRole="admin">
                <EditItem />
              </ProtectedRoute>
            }
          />

          <Route
            path="/manage-requests"
            element={
              <ProtectedRoute allowedRole="admin">
                <ManageRequests />
              </ProtectedRoute>
            }
          />

          <Route
            path="/return-confirmation"
            element={
              <ProtectedRoute allowedRole="admin">
                <ReturnConfirmation />
              </ProtectedRoute>
            }
          />

          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRole="admin">
                <Reports />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;