package com.taskr.core;

import com.taskr.core.Controllers.UserController;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserStorage;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;

import java.util.Collection;
import java.util.Collections;

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
        userStorage.delete(testUser);
        verify(userStorage).delete(testUser);
    }

    @Test
    public void shouldHaveAFindAllMethod(){
        UserStorage userStorage = mock(UserStorage.class);
        userStorage.findAll();
        verify(userStorage).findAll();

    }

    @Test
    public void shouldBeAbleToFindUserByName(){
        UserStorage userStorage = mock(UserStorage.class);
        userStorage.findUserByName("");
        verify(userStorage).findUserByName("");

    }
}
