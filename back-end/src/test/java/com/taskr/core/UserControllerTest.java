package com.taskr.core;

import com.taskr.core.Controllers.UserController;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserRepository;
import com.taskr.core.Storages.UserStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;


public class UserControllerTest {
//    private UserStorage userStorage;

    @Test
    public void shouldHaveAMethodToRetrieveAllUsers() {
        UserStorage userStorage = mock(UserStorage.class);
        UserController underTest = new UserController(userStorage);
        User testUser = new User("Aloo");
        userStorage.save(testUser);
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllUsers();
        assertThat(users).contains(testUser);
    }

    @Test
    public void shouldHaveAMethodToSaveUser() {
        UserStorage userStorage = mock(UserStorage.class);
        UserController underTest = new UserController(userStorage);
        User testUser = new User("Aloo");
        underTest.addNewUser(testUser);
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllUsers();
        assertThat(users).contains(testUser);
    }

    @Test
    public void shouldHaveAMethodToRetrieveSingleUser() {
        UserStorage userStorage = mock(UserStorage.class);
        UserController underTest = new UserController(userStorage);
        User testUser = new User("Aloo");
        underTest.addNewUser(testUser);
        when(userStorage.findById(1L)).thenReturn(testUser);
        User user = underTest.retrieveUserById(1L);
        assertThat(user).isEqualTo(testUser);
    }
}
