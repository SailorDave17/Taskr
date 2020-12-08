package com.taskr.core;

import com.taskr.core.model.User;
import com.taskr.core.storage.UserStorage;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

public class UserStorageTest {

    @Test
    public void shouldHaveAnAddUserMethod(){
        UserStorage userStorage = mock(UserStorage.class);
        User testUser = new User("Aloo");
        userStorage.save(testUser);
        verify(userStorage).save(testUser);
    }

    @Test
    public void shouldHaveADeleteUserMethod(){
        UserStorage userStorage = mock(UserStorage.class);
        User testUser = new User("Aloo");
        userStorage.save(testUser);
        userStorage.deleteById(testUser.getId());
        verify(userStorage).deleteById(testUser.getId());
    }

    @Test
    public void shouldHaveAFindAllMethod(){
        UserStorage userStorage = mock(UserStorage.class);
        userStorage.findAll();
        verify(userStorage).findAll();

    }

}
