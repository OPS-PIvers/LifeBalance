import React, { createContext, useContext, useState, ReactNode } from 'react';
import { ManualInitialData, ModalTab, TodoInitialData, ShoppingInitialData } from '../types/ui';

interface CaptureModalState {
  isOpen: boolean;
  initialTab?: ModalTab;
  initialData?: ManualInitialData;
  initialTodoData?: TodoInitialData;
  initialShoppingData?: ShoppingInitialData;
}

interface UIContextType {
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  captureModalState: CaptureModalState;
  openCaptureModal: (options?: {
    initialTab?: ModalTab;
    initialData?: ManualInitialData;
    initialTodoData?: TodoInitialData;
    initialShoppingData?: ShoppingInitialData;
  }) => void;
  closeCaptureModal: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [captureModalState, setCaptureModalState] = useState<CaptureModalState>({
    isOpen: false,
    initialTab: 'transaction'
  });

  const openCommandPalette = () => setIsCommandPaletteOpen(true);
  const closeCommandPalette = () => setIsCommandPaletteOpen(false);
  const toggleCommandPalette = () => setIsCommandPaletteOpen(prev => !prev);

  const openCaptureModal = (options?: {
    initialTab?: ModalTab;
    initialData?: ManualInitialData;
    initialTodoData?: TodoInitialData;
    initialShoppingData?: ShoppingInitialData;
  }) => {
    setCaptureModalState({
      isOpen: true,
      initialTab: options?.initialTab || 'transaction',
      initialData: options?.initialData,
      initialTodoData: options?.initialTodoData,
      initialShoppingData: options?.initialShoppingData
    });
  };

  const closeCaptureModal = () => {
    setCaptureModalState(prev => ({
      ...prev,
      isOpen: false,
      initialData: undefined, // Clear data on close
      initialTodoData: undefined,
      initialShoppingData: undefined
    }));
  };

  return (
    <UIContext.Provider value={{
      isCommandPaletteOpen,
      openCommandPalette,
      closeCommandPalette,
      toggleCommandPalette,
      captureModalState,
      openCaptureModal,
      closeCaptureModal
    }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
};
