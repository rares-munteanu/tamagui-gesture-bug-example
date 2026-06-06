import { useState } from 'react';
import { Sheet, styled, Text, View } from 'tamagui';

const Button = styled(View, {
  width: 150,
  height: 30,
  backgroundColor: '#111111',
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: 12,
  pressStyle: {
    backgroundColor: '#111111dd',
  },
});

const Container = styled(View, {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
});

const SheetContainer = styled(View, {
  padding: 20,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
});

export default function Index() {
  const onFramePressIn = () => console.log('Frame pressed in');
  const onFramePress = () => console.log('Frame pressed');

  const [open, setOpen] = useState(false);
  const onClose = () => {
    console.log('Closed');
    setOpen(false);
  };

  return (
    <Container>
      <Text>Edit src/app/index.tsx to edit this screen.</Text>
      <Button onPress={() => setOpen(true)} marginTop={20}>
        <Text color={'white'}>Open sheet</Text>
      </Button>

      <Sheet
        open={open}
        onOpenChange={(nextOpen: boolean) => {
          if (!nextOpen) onClose();
        }}
        snapPoints={[70]}
        snapPointsMode='percent'
        dismissOnSnapToBottom
        dismissOnOverlayPress>
        <Sheet.Overlay backgroundColor='#00000022' enterStyle={{ opacity: 0 }} exitStyle={{ opacity: 0 }} transition='200ms' />
        <Sheet.Frame onPressIn={onFramePressIn} onPress={onFramePress}>
          <Sheet.ScrollView showsVerticalScrollIndicator={false} scrollEventThrottle={16}>
            <SheetContainer>
              <Button
                onPress={() => {
                  console.log('Inner button pressed');
                  setOpen(false);
                }}>
                <Text color={'white'}>Press me</Text>
              </Button>
            </SheetContainer>
          </Sheet.ScrollView>
        </Sheet.Frame>
      </Sheet>
    </Container>
  );
}
